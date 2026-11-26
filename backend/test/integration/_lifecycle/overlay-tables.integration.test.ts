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
 * **Not measured here: the `x_*` column orphaned by the hard uninstall** (§5).
 * An overlay's `schemaExtensions` are #1853's (FR-065, Phase 9); until it lands
 * no overlay can declare a column, so there is no column to orphan.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'overlay_notes_fixture';
const ACTIVATION = 'overlay_notes_fixture.enabled';
const OWN = 'Migration20261125T120000OverlayNotesFixtureCreateNotes';

let database: DeploymentDatabase;
let orm: MikroORM;
let redis: Redis;
let orchestrator: ModuleLifecycleOrchestrator;
let bootAgain: () => Promise<void>;
let status: (argv: readonly string[]) => Promise<StatusRow>;
let noteId: string;

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
  it('first boot converges its registry row, marked as boot-converged; its migration is pending', async () => {
    expect(await tableExists()).toBe(false);
    await bootAgain();

    const row = await registration();
    expect(row?.state).toBe('installed');
    expect(row?.bootConvergedAt).toBeInstanceOf(Date);

    expect((await status([MODULE_ID])).migrations).toEqual([
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
    expect(row.migrations).toEqual([{ name: OWN, origin: 'overlay', state: 'applied' }]);
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
    const result = await orchestrator.uninstall(MODULE_ID, { hard: true });
    expect(result.revertedMigrations).toEqual([OWN]);
    expect(await tableExists()).toBe(false);
    expect(await registration()).toBeNull();
    expect((await status([MODULE_ID])).migrations).toEqual([
      { name: OWN, origin: 'overlay', state: 'pending' },
    ]);
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
      { name: OWN, origin: 'overlay', state: 'applied' },
    ]);
  });
});
