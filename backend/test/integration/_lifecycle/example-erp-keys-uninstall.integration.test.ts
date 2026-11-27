import { randomUUID } from 'node:crypto';

import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import {
  activeEntityExtensionContext,
  migrateUpVerified,
  verifyEntityExtensions,
  type EntityExtensionReport,
} from '@endora-commerce/platform/db';
import {
  buildStaticRegistry,
  loadModulePresence,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';

import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { loadDivergenceDeclaration } from '../../../src/overlay/divergence-loader.js';
import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';

/**
 * `example_erp_keys`' side table through the platform's side-table checks and
 * its lifecycle (`specs/190-overlay-full-modules/` US8, FR-095, T120, T123 C-3).
 *
 * C-3: `specs/187-side-table-extensions/`' checks are origin-agnostic, and its
 * own overlay leg (`test/integration/db/entity-extension-overlay-origin.test.ts`)
 * assembled the overlay contribution by hand. This file runs them over a real
 * overlay module discovered under `backend/src/apps/example/`: the metadata
 * rules M0 – M5 at ORM initialisation (an initialisation that returns passed
 * them), and the physical rules P1 – P4 in one catalog statement, with
 * `origin: overlay` the only thing that differs from a package.
 *
 * Then the hard uninstall `module-activation.md` asks every module with tables
 * to survive: its migration reverted, its side table dropped with the keys in
 * it, its registry row deleted; the host's rows untouched; and a tree that still
 * ships it converges it back and recreates the table, empty, at the next
 * `migrate` — verified again by the same statement.
 *
 * On the deployment's own template (`deploymentDatabase`), as every
 * overlay-table test is.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'example_erp_keys';
const TABLE = 'example_erp_keys_organization_keys';

let database: DeploymentDatabase;
let orm: MikroORM;
let redis: Redis;
let orchestrator: ModuleLifecycleOrchestrator;
let bootAgain: () => Promise<void>;
let own: readonly string[];
let organizationId: string;

const em = (): EntityManager => orm.em.fork();

async function tableExists(): Promise<boolean> {
  const rows = (await em()
    .getConnection()
    .execute(`select to_regclass('public.${TABLE}') as "table"`)) as { table: string | null }[];
  return (rows[0]?.table ?? null) !== null;
}

async function keyCount(): Promise<number> {
  const rows = (await em().getConnection().execute(`select count(*)::int as "n" from "${TABLE}"`)) as { n: number }[];
  return rows[0]?.n ?? -1;
}

async function verify(): Promise<{ report: EntityExtensionReport; statements: number; warnings: string[] }> {
  const warnings: string[] = [];
  let statements = 0;
  const report = await verifyEntityExtensions(
    (sql, params = []) => {
      statements += 1;
      return em().getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>;
    },
    activeEntityExtensionContext(),
    (line) => warnings.push(line),
  );
  return { report, statements, warnings };
}

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  // M0 – M5 run in `afterDiscovered`: an initialisation that returns is one that passed them.
  orm = await MikroORM.init(await database.config());
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

  const entries = await resolvedManifestEntries(database.env);
  const configured = await configuredMigrations(database.env);
  own = configured.ownership.migrationNamesFor(MODULE_ID) ?? [];
  const omissions = (await loadDivergenceDeclaration(database.env)).omittedModules.map((entry) => entry.moduleId);
  orchestrator = new ModuleLifecycleOrchestrator({
    orm,
    redis,
    em,
    auditLog: new AuditLogService(em),
    registry: buildStaticRegistry(entries),
    migrationOwnership: configured.ownership,
  });
  bootAgain = () => loadModulePresence({ em, entries, declaredOmissions: omissions });
  await bootAgain();
}, 180_000);

afterAll(async () => {
  redis?.disconnect();
  await orm?.close(true);
  await database?.drop();
});

describe('187’s side-table checks over a discovered overlay module (T123 C-3)', () => {
  it('resolves its declaration under origin overlay', () => {
    expect(
      activeEntityExtensionContext()
        .extensions.filter((extension) => extension.moduleId === MODULE_ID)
        .map((extension) => `${extension.origin}:${extension.declaration.entity}:${extension.declaration.table}`),
    ).toEqual([`overlay:organizations.Organization:${TABLE}`]);
  });

  it('maps the table to its own class, owned by the overlay module (M1, M2)', () => {
    expect(activeEntityExtensionContext().tables?.get(TABLE)).toEqual({
      moduleId: MODULE_ID,
      origin: 'overlay',
      className: 'ExampleErpOrganizationKey',
    });
  });

  it('verifies it in one statement: a cascading foreign key equal to its primary key (P1 – P4)', async () => {
    const { report, statements, warnings } = await verify();
    expect(statements).toBe(1);
    expect(report.findings).toEqual([]);
    expect(warnings).toEqual([]);
    expect(report.rows.filter((row) => row.moduleId === MODULE_ID)).toEqual([
      {
        kind: 'entity-extension',
        moduleId: MODULE_ID,
        origin: 'overlay',
        host: 'organizations.Organization',
        hostTable: 'organizations',
        table: TABLE,
        constraint: `${TABLE}_organization_fk`,
        status: 'verified',
      },
    ]);
  });
});

describe('example_erp_keys through a hard uninstall [integration]', () => {
  it('owns exactly its one migration, applied', async () => {
    expect(own).toHaveLength(1);
    const applied = (await em().getConnection().execute('select "name" from "mikro_orm_migrations"')) as {
      name: string;
    }[];
    expect(applied.map((row) => row.name)).toEqual(expect.arrayContaining([...own]));
    expect(await tableExists()).toBe(true);
  });

  it('keeps its keys through a soft uninstall and restores over them', async () => {
    organizationId = randomUUID();
    await em()
      .getConnection()
      .execute(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
         values (?, 'ERP keys lifecycle', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
        [organizationId, `ERP${organizationId.slice(0, 13).replace(/-/g, '').toUpperCase()}`, `/${organizationId}/`],
      );
    await em()
      .getConnection()
      .execute(`insert into "${TABLE}" ("organization_id","erp_key") values (?, 'SAP-LIFECYCLE')`, [organizationId]);

    expect((await orchestrator.uninstall(MODULE_ID, { hard: false })).revertedMigrations).toEqual([]);
    expect(await keyCount()).toBe(1);
    expect((await orchestrator.install(MODULE_ID)).appliedMigrations).toEqual([]);
    expect(await keyCount()).toBe(1);
  });

  it('a hard uninstall reverts its migration, drops the side table and deletes its registry row', async () => {
    const result = await orchestrator.uninstall(MODULE_ID, { hard: true });
    expect(result.revertedMigrations).toEqual([...own]);
    expect(await tableExists()).toBe(false);
    expect(await em().findOne(ModuleRegistration, { moduleId: MODULE_ID })).toBeNull();
  });

  it('and leaves the host alone: the Organization it keyed is still there', async () => {
    const rows = (await em()
      .getConnection()
      .execute('select "id" from "organizations" where "id" = ?', [organizationId])) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('a tree that still ships it converges it back, and the next migrate recreates the table, empty and verified', async () => {
    await bootAgain();
    expect((await em().findOne(ModuleRegistration, { moduleId: MODULE_ID }))?.state).toBe('installed');
    await migrateUpVerified(orm);
    expect(await tableExists()).toBe(true);
    expect(await keyCount()).toBe(0);
    const { report } = await verify();
    expect(report.findings).toEqual([]);
    expect(report.rows.filter((row) => row.moduleId === MODULE_ID).map((row) => row.status)).toEqual(['verified']);
  });
});
