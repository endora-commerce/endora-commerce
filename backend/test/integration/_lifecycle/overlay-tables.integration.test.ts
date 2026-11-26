import { randomUUID } from 'node:crypto';

import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import { migrateUpVerified } from '@endora-commerce/platform/db';
import {
  buildStaticRegistry,
  loadModulePresence,
  ModuleLifecycleOrchestrator,
  runStatusCommand,
  type OperatorRuntime,
} from '@endora-commerce/platform/lifecycle';

import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { loadDivergenceDeclaration } from '../../../src/overlay/divergence-loader.js';
import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';

/**
 * The lifecycle of an overlay module that owns a table
 * (`specs/190-overlay-full-modules/` US5, FR-045, T090;
 * `contracts/overlay-lifecycle.md` §1 and §5).
 *
 * An overlay module with tables has the lifecycle of a module this build
 * ships — the one a core module has here — not the one an installed package
 * has: the first boot converges its registry row, `module:install` applies its
 * pending migrations, `module:status` lists them with origin `overlay`, both
 * off-switches leave its rows alone, and a hard uninstall reverts what the
 * ownership answer lists. §2's removal clause is the last two steps: a tree
 * that still ships the directory converges the module back at the next boot and
 * recreates its table, **empty**, at the next `migrate`.
 *
 * The subject is `example`'s `overlay_notes_fixture` (one organization-scoped
 * table), selected **in-process** on the deployment's own template
 * (`deploymentDatabase`, FR-039/FR-040) — the template every overlay-table
 * test shares. The template arrives fully migrated, so the file starts by
 * reverting the overlay's one migration: that is the database of a shop whose
 * tree gained the module after its last `migrate`, which is the state
 * `module:install` exists to repair.
 *
 * The module also declares one `x_*` column on `organizations` (#1853, FR-065 –
 * FR-066): the generated step lands at the head of its block, its ledger rows
 * sit under its id, the hard uninstall reverts the step with its migration and
 * leaves the column and its value in place, `orphaned`, and the next `migrate`
 * re-attaches it.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'overlay_notes_fixture';
const ACTIVATION = 'overlay_notes_fixture.enabled';
const OWN = 'Migration20261125T120000OverlayNotesFixtureCreateNotes';
const COLUMN = 'x_overlay_notes_fixture_last_note_at';

let database: DeploymentDatabase;
let orm: MikroORM;
let redis: Redis;
let orchestrator: ModuleLifecycleOrchestrator;
let bootAgain: () => Promise<void>;
let status: (argv: readonly string[]) => Promise<StatusRow>;
let noteId: string;
let columnOrganizationId: string;

interface StatusRow {
  readonly id: string;
  readonly state: string;
  readonly migrations?: ReadonlyArray<{ name: string; origin: string; state: string }> | null;
}

const em = (): EntityManager => orm.em.fork();

async function tableExists(): Promise<boolean> {
  const rows = (await em()
    .getConnection()
    .execute(`select to_regclass('public.overlay_fixture_notes') as "table"`)) as { table: string | null }[];
  return rows[0]?.table !== null && rows[0]?.table !== undefined;
}

async function noteCount(): Promise<number> {
  const rows = (await em()
    .getConnection()
    .execute('select count(*)::int as "n" from "overlay_fixture_notes"')) as { n: number }[];
  return rows[0]?.n ?? -1;
}

/** The module's `schema_extensions` ledger rows, `physical_name → status`. */
async function ledger(): Promise<Record<string, string>> {
  const rows = (await em()
    .getConnection()
    .execute(
      `select "physical_name", "status" from "schema_extensions" where "module_id" = ? order by 1`,
      [MODULE_ID],
    )) as { physical_name: string; status: string }[];
  return Object.fromEntries(rows.map((row) => [row.physical_name, row.status]));
}

async function columnExists(): Promise<boolean> {
  const rows = (await em()
    .getConnection()
    .execute(
      `select 1 from information_schema.columns where table_name = 'organizations' and column_name = ?`,
      [COLUMN],
    )) as unknown[];
  return rows.length === 1;
}

/** The generated step's name, off the module's own migration list. */
async function generatedStep(): Promise<string> {
  const { registered } = await configuredMigrations(database.env);
  const own = (await configuredMigrations(database.env)).ownership.migrationNamesFor(MODULE_ID) ?? [];
  const step = registered.find((m) => m.origin === 'generated' && own.includes(m.name));
  expect(step).toBeDefined();
  return step!.name;
}

async function registration(): Promise<ModuleRegistration | null> {
  return em().findOne(ModuleRegistration, { moduleId: MODULE_ID });
}

/**
 * The operator axis, as `module.activation.set` writes it: the module's
 * activation Setting and nothing else (the Command never touches
 * `module_registrations`), then the local refresh `propagateActivationChange`
 * runs in the writing process.
 */
async function setActivation(active: boolean): Promise<void> {
  await em()
    .getConnection()
    .execute(`update "settings" set "global_value" = ?::jsonb where "code" = ?`, [
      JSON.stringify(active),
      ACTIVATION,
    ]);
  await registryCache.refreshFromDb(em);
}

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  orm = await MikroORM.init(await database.config());
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  const entries = await resolvedManifestEntries(database.env);
  const configured = await configuredMigrations(database.env);
  const omissions = (await loadDivergenceDeclaration(database.env)).omittedModules.map(
    (entry) => entry.moduleId,
  );
  orchestrator = new ModuleLifecycleOrchestrator({
    orm,
    redis,
    em,
    auditLog: new AuditLogService(em),
    registry: buildStaticRegistry(entries),
    migrationOwnership: configured.ownership,
  });
  bootAgain = () => loadModulePresence({ em, entries, declaredOmissions: omissions });

  const runtime: OperatorRuntime = {
    resources: () => Promise.resolve({ orm, em, redis }),
    entries,
    migrations: () => configuredMigrations(database.env),
    out: (line) => void printed.push(line),
    err: () => undefined,
  };
  const printed: string[] = [];
  status = async (argv) => {
    printed.length = 0;
    expect(await runStatusCommand([...argv, '--json'], runtime)).toBe(0);
    const { modules } = JSON.parse(printed.join('')) as { modules: StatusRow[] };
    expect(modules).toHaveLength(1);
    return modules[0]!;
  };

  // A shop whose tree gained the module after its last `migrate`.
  await orm.migrator.down({ migrations: [OWN] });
}, 180_000);

afterAll(async () => {
  redis?.disconnect();
  await orm?.close(true);
  await database?.drop();
});

describe('an overlay module that owns a table, through its lifecycle [integration]', () => {
  it('its declared column comes from a generated step at the head of its block, ledgered under its id', async () => {
    const { names } = await configuredMigrations(database.env);
    const step = await generatedStep();
    expect(names.indexOf(step)).toBe(names.indexOf(OWN) - 1);
    // The template arrived fully migrated: the column is there, applied.
    expect(await columnExists()).toBe(true);
    expect(await ledger()).toEqual({ [COLUMN]: 'applied' });
  });

  it('first boot converges its registry row, marked as boot-converged; its migration is pending', async () => {
    expect(await tableExists()).toBe(false);
    await bootAgain();

    const row = await registration();
    expect(row?.state).toBe('installed');
    expect(row?.bootConvergedAt).toBeInstanceOf(Date);

    expect((await status([MODULE_ID])).migrations).toEqual([
      { name: await generatedStep(), origin: 'generated', state: 'applied' },
      { name: OWN, origin: 'overlay', state: 'pending' },
    ]);
  });

  it('install applies its pending migration and completes the boot-converged row', async () => {
    const result = await orchestrator.install(MODULE_ID);
    expect(result.state).toBe('installed');
    expect(result.appliedMigrations).toContain(OWN);
    expect(await tableExists()).toBe(true);
    expect((await registration())?.bootConvergedAt ?? null).toBeNull();

    // Its activation control was reconciled with the rest of its settings.
    const settings = (await em()
      .getConnection()
      .execute('select "code" from "settings" where "code" = ?', [ACTIVATION])) as unknown[];
    expect(settings).toHaveLength(1);
  });

  it('status lists the migration by name, with origin overlay, applied', async () => {
    const row = await status([MODULE_ID]);
    expect(row.state).toBe('installed');
    expect(row.migrations).toEqual([
      { name: await generatedStep(), origin: 'generated', state: 'applied' },
      { name: OWN, origin: 'overlay', state: 'applied' },
    ]);
  });

  it('deactivating it (operator axis) makes it absent and leaves its table and rows untouched', async () => {
    const organizationId = randomUUID();
    await em()
      .getConnection()
      .execute(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
         values (?, 'Overlay lifecycle', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
        [organizationId, `OVL${organizationId.slice(0, 13).replace(/-/g, '').toUpperCase()}`, `/${organizationId}/`],
      );
    columnOrganizationId = organizationId;
    await em()
      .getConnection()
      .execute(`update "organizations" set "${COLUMN}" = '2026-11-25T12:00:00Z' where "id" = ?`, [organizationId]);
    noteId = randomUUID();
    await em()
      .getConnection()
      .execute(
        `insert into "overlay_fixture_notes" ("id","organization_id","body","created_at") values (?, ?, 'kept', now())`,
        [noteId, organizationId],
      );

    await setActivation(false);
    expect(effectiveState.isPresent(MODULE_ID)).toBe(false);
    expect(effectiveState.presence(MODULE_ID)?.platformAvailable).toBe(true);
    expect((await registration())?.state).toBe('installed');
    expect(await noteCount()).toBe(1);
  });

  it('activating it again restores it, rows as they were', async () => {
    await setActivation(true);
    expect(effectiveState.isPresent(MODULE_ID)).toBe(true);
    expect(await noteCount()).toBe(1);
  });

  it('a soft uninstall leaves its table and rows untouched', async () => {
    const result = await orchestrator.uninstall(MODULE_ID, { hard: false });
    expect(result.state).toBe('uninstalled');
    expect(result.revertedMigrations).toEqual([]);
    expect((await registration())?.state).toBe('uninstalled');
    expect(await tableExists()).toBe(true);
    expect(await noteCount()).toBe(1);
  });

  it('install restores it over the kept table, applying nothing', async () => {
    const result = await orchestrator.install(MODULE_ID);
    expect(result.state).toBe('installed');
    expect(result.appliedMigrations).not.toContain(OWN);
    expect(await noteCount()).toBe(1);
  });

  it('a hard uninstall reverts its migration, drops its table and deletes its registry row', async () => {
    const step = await generatedStep();
    const result = await orchestrator.uninstall(MODULE_ID, { hard: true });
    expect(result.revertedMigrations).toEqual([OWN, step]);
    expect(await tableExists()).toBe(false);
    expect(await registration()).toBeNull();
    expect((await status([MODULE_ID])).migrations).toEqual([
      { name: step, origin: 'generated', state: 'pending' },
      { name: OWN, origin: 'overlay', state: 'pending' },
    ]);
  });

  it('and keeps its x_* column and the value in it, orphaned (FR-066)', async () => {
    expect(await columnExists()).toBe(true);
    expect(await ledger()).toEqual({ [COLUMN]: 'orphaned' });
    const rows = (await em()
      .getConnection()
      .execute(`select "${COLUMN}" as "value" from "organizations" where "id" = ?`, [
        columnOrganizationId,
      ])) as { value: string | Date | null }[];
    expect(rows[0]?.value).not.toBeNull();
    expect(new Date(rows[0]!.value!).toISOString()).toBe('2026-11-25T12:00:00.000Z');
  });

  it('a tree that still ships it converges it back at the next boot (§2)', async () => {
    await bootAgain();
    const row = await registration();
    expect(row?.state).toBe('installed');
    expect(row?.bootConvergedAt).toBeInstanceOf(Date);
  });

  it('and the next migrate recreates its table, empty (§2)', async () => {
    await migrateUpVerified(orm);
    expect(await tableExists()).toBe(true);
    expect(await noteCount()).toBe(0);
    expect((await status([MODULE_ID])).migrations).toEqual([
      { name: await generatedStep(), origin: 'generated', state: 'applied' },
      { name: OWN, origin: 'overlay', state: 'applied' },
    ]);
    // The orphaned column is re-attached, not recreated: the value survives.
    expect(await ledger()).toEqual({ [COLUMN]: 'applied' });
  });
});
