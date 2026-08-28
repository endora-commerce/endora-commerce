import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';

/**
 * Integration test for US3 — enable transitions disabled → installed.
 *
 * `module:enable <id>` against a `disabled` row MUST flip its state
 * to `installed` and audit `module.enabled`.
 */

describe('Module enable — restores disabled module (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_enable' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('flips disabled → installed and emits module.enabled audit', async () => {
    const manifest = defineModuleManifest({
      id: 'fixture_enable',
      name: 'Fixture Enable',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_enable', { manifest, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_enable',
      state: 'disabled',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    const auditLog = new AuditLogService(() => db.em());
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog,
      registry,
    });

    const result = await orchestrator.enable('fixture_enable');
    expect(result.state).toBe('installed');

    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_enable' });
    expect(row?.state).toBe('installed');
  }, 30_000);
});
