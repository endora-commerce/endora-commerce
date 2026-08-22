import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { migrationOwnershipOf } from '../../../src/db/configured-migrations.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';

/**
 * Integration test for FR-011 scoped migration revert (US2).
 *
 * Hard uninstall MUST revert ONLY the target module's migrations — resolved
 * from `MIGRATION_REGISTRY` by `moduleId` since feature 065. Other modules'
 * migrations remain applied.
 *
 * This case covers a module that owns no registered migration: the orchestrator
 * warns and reverts nothing. The positive case (a module that does own
 * migrations, and the order they come back in) is
 * `uninstall-revert.integration.test.ts`.
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

  it('hard uninstall returns a revertedMigrations array scoped by owning module', async () => {
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
      // Feature 080 (T033): the ownership seam covers this fixture module and
      // says it owns nothing — which is the branch this test is about. Left
      // out, the orchestrator would answer for core alone, find no
      // `fixture_scoped` in it and **refuse**, which is the other branch and
      // the right answer to a different question.
      migrationOwnership: migrationOwnershipOf(MIGRATION_REGISTRY, [
        'core',
        'fixture_scoped',
        ...REGISTERED_MANIFESTS.map((entry) => entry.manifest.id),
      ]),
    });

    const result = await orchestrator.uninstall('fixture_scoped', { hard: true });
    // `fixture_scoped` is covered and owns no migration, so the revert is a
    // logged no-op. Other modules' migrations are unaffected (the migrator was
    // never asked to revert them).
    expect(result.revertedMigrations).toEqual([]);
    // Migrations belonging to `dictionaries` and `_lifecycle` MUST NOT appear.
    for (const name of result.revertedMigrations) {
      expect(name).not.toMatch(/dictionary/);
      expect(name).not.toMatch(/module_lifecycle/);
    }
  }, 30_000);
});
