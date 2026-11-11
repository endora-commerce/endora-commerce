import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { MikroORM } from '@mikro-orm/postgresql';
import { defineModuleManifest } from '@endora-commerce/contracts';
import {
  LifecycleError,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
  type LoadedManifestRegistry,
} from '@endora-commerce/platform/lifecycle';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import { activeSchemaExtensionContext, migrateUpVerified } from '@endora-commerce/platform/db';

import {
  DECLARING_MODULE,
  FIXTURE_HOST_MODULE,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-023, FR-034, FR-082 (tasks.md T027) —
 * uninstall keeps an extension's columns; dropping them is explicit (OD-29).
 *
 * The fixture platform carries every platform migration (the orchestrator reads
 * registrations, settings and the audit log), the fixture host module and the
 * declaring module, in a database of its own.
 */

const declaration = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

const hostManifest = defineModuleManifest({ id: FIXTURE_HOST_MODULE, name: 'Fixture host', version: '1.0.0', dependencies: [] });
const declaringManifest = defineModuleManifest({
  id: DECLARING_MODULE,
  name: 'Acme ERP',
  version: '1.0.0',
  dependencies: [FIXTURE_HOST_MODULE],
});

let db: ThrowawayDatabase;
let orm: MikroORM;
let redis: Redis;

function orchestrator(): ModuleLifecycleOrchestrator {
  const registry: LoadedManifestRegistry = {
    modules: new Map([
      [FIXTURE_HOST_MODULE, { manifest: hostManifest, filePath: '<test>' }],
      [DECLARING_MODULE, { manifest: declaringManifest, filePath: '<test>' }],
    ]) as never,
    graph: new ModuleDepGraph([hostManifest, declaringManifest]),
    participants: [],
  };
  return new ModuleLifecycleOrchestrator({
    orm,
    redis,
    em: () => orm.em.fork(),
    auditLog: new AuditLogService(() => orm.em.fork()),
    registry,
    migrationOwnership: activeSchemaExtensionContext().ownership!,
  });
}

async function register(moduleId: string): Promise<void> {
  const em = orm.em.fork();
  const now = new Date();
  em.create(ModuleRegistration, {
    moduleId,
    state: 'installed',
    version: '1.0.0',
    installedAt: now,
    lastStateChangeAt: now,
    lastInstallFailedAt: null,
    lastInstallError: null,
  });
  await em.flush();
}

async function ledger(): Promise<string[]> {
  const rows = await db.query<{ status: string }>(`select status from schema_extensions order by physical_name`);
  return rows.map((row) => row.status);
}

async function extensionColumns(): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'x178_hosts' and column_name like 'x\\_%' order by 1`,
  );
  return rows.map((row) => row.column_name);
}

beforeAll(async () => {
  db = await throwawayDatabase();
  orm = await openFixtureOrm(db.url, [declaration], { platform: true });
  await migrateUpVerified(orm);
  await register(FIXTURE_HOST_MODULE);
  await register(DECLARING_MODULE);
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
}, 120_000);

afterAll(async () => {
  redis?.disconnect();
  await orm?.close(true);
  await db?.drop();
});

describe('uninstall and declared extension columns', () => {
  it('refuses to uninstall the host while the declaring module is installed (dependents-block)', async () => {
    const error = await orchestrator()
      .uninstall(FIXTURE_HOST_MODULE, { hard: true })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LifecycleError);
    expect((error as LifecycleError).kind).toBe('dependents-block');
    expect((error as Error).message).toContain(DECLARING_MODULE);
  }, 30_000);

  it('hard-uninstalling the declaring module orphans its rows and keeps its columns', async () => {
    await db.query(`insert into x178_hosts (id, name, x_acme_erp_erp_code) values (gen_random_uuid(), 'n', 'kept')`);
    const result = await orchestrator().uninstall(DECLARING_MODULE, { hard: true });
    expect(result.revertedMigrations).toEqual([expect.stringMatching(/^Migration10000101T000000AcmeErpSchemaExtensions/)]);
    expect(new Set(await ledger())).toEqual(new Set(['orphaned']));
    expect(await extensionColumns()).toEqual(['x_acme_erp_credit_tier', 'x_acme_erp_erp_code']);
    const [row] = await db.query<{ x_acme_erp_erp_code: string }>(`select x_acme_erp_erp_code from x178_hosts`);
    expect(row?.x_acme_erp_erp_code).toBe('kept');
  }, 30_000);

  it('hard-uninstalling the host afterwards marks the rows dropped', async () => {
    await orchestrator().uninstall(FIXTURE_HOST_MODULE, { hard: true });
    expect(new Set(await ledger())).toEqual(new Set(['dropped']));
    const [table] = await db.query(`select to_regclass('x178_hosts') as t`);
    expect(table).toEqual({ t: null });
  }, 30_000);
});
