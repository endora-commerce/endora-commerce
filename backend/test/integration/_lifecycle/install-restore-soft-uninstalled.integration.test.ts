import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for SC-008 — soft-uninstalled module re-installs
 * to working state in under 5 s with no migration cost (US1 / FR-007).
 */

describe('Module install — restore from soft uninstall (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_restore' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('soft-uninstalled → install completes in under 5 s (no migration cost)', async () => {
    const manifest = defineModuleManifest({
      id: 'fixture_restore',
      name: 'Fixture Restore',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_restore', { manifest, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
    });

    // Seed as soft-uninstalled (preserved row from a prior run).
    const em = db.em();
    const installedAt = new Date(Date.now() - 60_000);
    em.create(ModuleRegistration, {
      moduleId: 'fixture_restore',
      state: 'uninstalled',
      version: '1.0.0',
      installedAt,
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    const start = Date.now();
    const result = await orchestrator.install('fixture_restore');
    const duration = Date.now() - start;

    expect(result.state).toBe('installed');
    expect(duration).toBeLessThan(5_000);
    // Original installed_at is preserved across the soft-uninstall + reinstall cycle.
    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_restore' });
    expect(row?.installedAt.getTime()).toBe(installedAt.getTime());
  }, 30_000);
});
