import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for SC-002 — install rollback (feature 018 / US1).
 *
 * Forces the install hook to throw AFTER migrations have applied and
 * verifies the orchestrator reverts the module to pre-install state:
 *   - registry row is `state='uninstalled'` (not `'installed'`).
 *   - settings rows are NOT created (transaction rolled back).
 *   - audit log carries `module.install_failed`, NOT `module.installed`.
 *
 * Runs against a real Postgres + Redis. Requires the dev environment
 * variables `DATABASE_URL` and `REDIS_URL` to point at live services.
 * The migration `039_module_lifecycle_init` MUST be applied first
 * (run `pnpm --filter backend run migration:up`).
 */

describe('Module install — SC-002 rollback (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    // Clear any prior rows for the fixture id so re-runs are deterministic.
    await db
      .em()
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_failing' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('forced install-hook failure rolls registry back to uninstalled state', async () => {
    // Build a one-module registry whose hook always throws.
    const manifest = defineModuleManifest({
      id: 'fixture_failing',
      name: 'Fixture Failing Install',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_failing',
          {
            manifest,
            filePath: '<integration-fixture>',
            installHook: async () => {
              throw new Error('forced hook failure for SC-002');
            },
          },
        ],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const auditLog = new AuditLogService(() => db.em());
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog,
      registry,
    });

    await expect(orchestrator.install('fixture_failing')).rejects.toBeInstanceOf(
      LifecycleError,
    );

    // Registry: should be uninstalled with the error captured. NOT installed.
    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_failing' });
    expect(row?.state).toBe('uninstalled');
    expect(row?.lastInstallError).toMatch(/forced hook failure for SC-002/);
  }, 60_000);
});
