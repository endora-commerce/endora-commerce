import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-013 — uninstall of an already-uninstalled
 * module (or a module with no row at all) MUST exit cleanly with
 * state='already-uninstalled' and perform no destructive action.
 */

describe('Module uninstall — idempotency (integration)', () => {
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
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_uidemp' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('uninstall against a missing row is a no-op', async () => {
    let hookCalls = 0;
    const manifest = defineModuleManifest({
      id: 'fixture_uidemp',
      name: 'Fixture Uninstall Idempotent',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_uidemp',
          {
            manifest,
            filePath: '<test>',
            uninstallHook: async () => {
              hookCalls++;
            },
          },
        ],
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

    const result = await orchestrator.uninstall('fixture_uidemp', { hard: false });
    expect(result.state).toBe('already-uninstalled');
    expect(hookCalls).toBe(0);
  }, 30_000);
});
