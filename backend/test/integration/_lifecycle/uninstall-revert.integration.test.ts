import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModuleManifest } from '@b2b/contracts';
import type { IMigrator } from '@mikro-orm/core';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/modules/_lifecycle/entities/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.js';

/**
 * Hard uninstall must revert the target module's migrations.
 *
 * Before feature 065 this path scanned `src/db/migrations/` for filenames
 * matching `^\d+_<moduleId>_` and passed the basename as the migration name.
 * Both halves were wrong: module migrations do not live in that directory, and
 * `mikro_orm_migrations.name` holds the **class** name. The path therefore
 * matched nothing and only logged — a silent no-op, asserted below.
 *
 * The migrator is stubbed through the `migratorFor` seam so the test proves the
 * resolution (which names, in which order) without dropping tables from the
 * shared test database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dbMigrationsDir = resolve(here, '../../../src/db/migrations');

/** The module the assertions run against — it owns several migrations. */
const TARGET_MODULE = 'catalog';

function ownedMigrationNames(moduleId: string): string[] {
  return MIGRATION_REGISTRY.filter((entry) => entry.moduleId === moduleId).map(
    (entry) => entry.cls.name,
  );
}

interface RecordingMigrator {
  migrator: IMigrator;
  reverted: string[];
}

function recordingMigrator(): RecordingMigrator {
  const reverted: string[] = [];
  const migrator = {
    down: async (options?: { migrations?: string[] }) => {
      const names = options?.migrations ?? [];
      reverted.push(...names);
      return names.map((name) => ({ name }));
    },
    up: async () => [],
    getPendingMigrations: async () => [],
    getExecutedMigrations: async () => [],
  } as unknown as IMigrator;
  return { migrator, reverted };
}

describe('Module uninstall — migration revert resolves from the registry (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db
      .em()
      .nativeDelete(ModuleRegistration, { moduleId: { $in: [TARGET_MODULE, 'fixture_no_migs'] } });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  async function seedInstalled(moduleId: string): Promise<void> {
    const em = db.em();
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

  function orchestratorFor(
    moduleId: string,
    migrator: IMigrator,
  ): ModuleLifecycleOrchestrator {
    const manifest = defineModuleManifest({
      id: moduleId,
      name: moduleId,
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([[moduleId, { manifest, filePath: '<test>' }]]) as never,
      graph: new ModuleDepGraph([manifest]),
    };
    return new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
      migratorFor: async () => migrator,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  }

  it('the pre-065 filename scan matched nothing (the bug this replaces)', () => {
    // src/db/migrations/ holds only the `core` migrations, and none of them —
    // nor any module migration — uses the legacy `NNN_<moduleId>_` filename.
    const legacyPattern = new RegExp(`^\\d+_${TARGET_MODULE}_`);
    const matches = existsSync(dbMigrationsDir)
      ? readdirSync(dbMigrationsDir).filter((file) => legacyPattern.test(file))
      : [];
    expect(matches).toEqual([]);

    // Yet the module genuinely owns migrations, which is what must be reverted.
    expect(ownedMigrationNames(TARGET_MODULE).length).toBeGreaterThan(1);
  });

  it("reverts exactly the module's own migrations, newest first", async () => {
    await seedInstalled(TARGET_MODULE);
    const { migrator, reverted } = recordingMigrator();

    const result = await orchestratorFor(TARGET_MODULE, migrator).uninstall(TARGET_MODULE, {
      hard: true,
    });

    const owned = ownedMigrationNames(TARGET_MODULE);
    const expected = [...owned].sort().reverse();

    expect(reverted).toEqual(expected);
    expect(result.revertedMigrations).toEqual(expected);
    expect(reverted.length).toBeGreaterThan(1);
  }, 30_000);

  it('never touches another module’s migrations', async () => {
    await seedInstalled(TARGET_MODULE);
    const { migrator, reverted } = recordingMigrator();

    await orchestratorFor(TARGET_MODULE, migrator).uninstall(TARGET_MODULE, { hard: true });

    const foreign = MIGRATION_REGISTRY.filter((entry) => entry.moduleId !== TARGET_MODULE).map(
      (entry) => entry.cls.name,
    );
    for (const name of reverted) {
      expect(foreign).not.toContain(name);
    }
  }, 30_000);

  it('reverts nothing and warns for a module with no migrations', async () => {
    await seedInstalled('fixture_no_migs');
    const { migrator, reverted } = recordingMigrator();
    const warnings: string[] = [];

    const manifest = defineModuleManifest({
      id: 'fixture_no_migs',
      name: 'Fixture',
      version: '1.0.0',
      dependencies: [],
    });
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry: {
        modules: new Map([['fixture_no_migs', { manifest, filePath: '<test>' }]]) as never,
        graph: new ModuleDepGraph([manifest]),
      },
      migratorFor: async () => migrator,
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    });

    const result = await orchestrator.uninstall('fixture_no_migs', { hard: true });

    expect(reverted).toEqual([]);
    expect(result.revertedMigrations).toEqual([]);
    expect(warnings.some((message) => message.includes('fixture_no_migs'))).toBe(true);
  }, 30_000);
});
