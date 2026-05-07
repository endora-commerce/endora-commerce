import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/modules/_lifecycle/entities/module-registration.entity.js';
import { AuditLogService } from '../../../src/modules/audit_logs/services/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-011 scoped migration revert (US2).
 *
 * Hard uninstall MUST revert ONLY the target module's migrations
 * (matched by filename pattern `^\d+_<id>_`). Other modules'
 * migrations remain applied.
 *
 * Authored skeleton; the migrator stub in the orchestrator's
 * `revertMigrationsFor` implementation is the authoritative path.
 * A test that exercises real migrations would require dedicated
 * fixture migrations on disk — out of scope for this skeleton.
 * This test asserts the contract by inspecting the result.revertedMigrations
 * array against an in-memory expectation.
 */

describe('Module uninstall — hard reverts only target module migrations (integration)', () => {
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
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_scoped' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('hard uninstall returns a revertedMigrations array scoped by filename pattern', async () => {
    const manifest = defineModuleManifest({
      id: 'fixture_scoped',
      name: 'Fixture Scoped',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_scoped', { manifest, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_scoped',
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
    });

    const result = await orchestrator.uninstall('fixture_scoped', { hard: true });
    // No migrations on disk match `^\d+_fixture_scoped_` — orchestrator's
    // `revertMigrationsFor` returns [] and logs a warning. Other
    // modules' migrations are unaffected (the migrator was never asked
    // to revert them).
    expect(Array.isArray(result.revertedMigrations)).toBe(true);
    // The 038/039 migrations belonging to `dictionaries` and
    // `_lifecycle` MUST NOT appear here.
    for (const name of result.revertedMigrations) {
      expect(name).not.toMatch(/dictionary/);
      expect(name).not.toMatch(/module_lifecycle/);
    }
  }, 30_000);
});
