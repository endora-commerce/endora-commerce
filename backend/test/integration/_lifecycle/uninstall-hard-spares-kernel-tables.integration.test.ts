import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModuleManifest } from '@b2b/contracts';
import type { IMigrator } from '@mikro-orm/core';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';
import { collectMigrationTables, kernelOwnedTables } from '../../helpers/migration-tables.js';

/**
 * Feature 072 T020 — a hard uninstall never reverts kernel-owned schema.
 *
 * `revertMigrationsFor()` (`_lifecycle/services/orchestrator.ts`) resolves what
 * to revert from `MIGRATION_REGISTRY` by `moduleId`. Before T020 the settings
 * and sales-channel migrations were still filed under their modules, so
 * `modules:uninstall --hard settings` reverted six migrations and dropped
 * `settings`, `setting_groups` and `setting_values` — tables the kernel has
 * owned since T018 — and `--hard sales_channels` stripped eight columns off the
 * kernel's `sales_channels` table.
 *
 * The migrator is stubbed through the `migratorFor` seam, so this proves which
 * migrations the orchestrator resolves without dropping anything from the
 * shared test database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../../../src');

/** The modules whose entire schema the kernel absorbed in T018/T019. */
const RELOCATED_MODULES = ['settings', 'sales_channels'] as const;

const kernelTables = kernelOwnedTables(backendSrc);

/** Migration class names whose SQL writes to a kernel-owned table. */
const KERNEL_SCHEMA_MIGRATIONS = collectMigrationTables(backendSrc)
  .filter((migration) => [...migration.tables].some((table) => kernelTables.has(table)))
  .map((migration) => migration.className);

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

describe('Module uninstall — hard uninstall spares kernel-owned schema (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: { $in: [...RELOCATED_MODULES] } });
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

  function orchestratorFor(moduleId: string, migrator: IMigrator): ModuleLifecycleOrchestrator {
    const manifest = defineModuleManifest({
      id: moduleId,
      name: moduleId,
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([[moduleId, { manifest, filePath: '<test>' }]]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
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

  it('resolves a non-empty set of kernel-schema migrations (guards the assertion)', () => {
    // If this scan ever comes back empty the assertions below pass vacuously.
    expect(KERNEL_SCHEMA_MIGRATIONS.length).toBeGreaterThan(6);
    expect(kernelTables.has('settings')).toBe(true);
    expect(kernelTables.has('sales_channels')).toBe(true);
  });

  for (const moduleId of RELOCATED_MODULES) {
    it(`hard uninstall of ${moduleId} reverts no migration that writes to a kernel table`, async () => {
      await seedInstalled(moduleId);
      const { migrator, reverted } = recordingMigrator();

      const result = await orchestratorFor(moduleId, migrator).uninstall(moduleId, { hard: true });

      for (const name of reverted) {
        expect(
          KERNEL_SCHEMA_MIGRATIONS,
          `hard uninstall of "${moduleId}" reverted ${name}, which writes to a ` +
            `kernel-owned table`,
        ).not.toContain(name);
      }
      expect(result.revertedMigrations).toEqual(reverted);
      // Both modules' schema is entirely the kernel's now, so there is nothing
      // left for either to revert at all.
      expect(reverted).toEqual([]);
    }, 30_000);
  }
});
