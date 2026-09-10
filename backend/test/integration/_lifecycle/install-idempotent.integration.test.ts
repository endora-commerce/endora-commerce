import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { AuditLogService } from '@endora-commerce/platform/composition';

/**
 * Integration test for FR-007 — install is idempotent (US1).
 *
 * A second `module:install <id>` against an already-installed module
 * MUST exit cleanly with `state='already-installed'` and MUST NOT
 * re-run the install hook.
 */

describe('Module install — idempotency (integration)', () => {
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
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_idemp' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('second install short-circuits; hook fires exactly once across two calls', async () => {
    let hookCalled = 0;
    const manifest = defineModuleManifest({
      id: 'fixture_idemp',
      name: 'Fixture Idempotent',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_idemp',
          {
            manifest,
            filePath: '<test>',
            installHook: async () => {
              hookCalled++;
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

    const first = await orchestrator.install('fixture_idemp');
    expect(first.state).toBe('installed');
    expect(hookCalled).toBe(1);

    const second = await orchestrator.install('fixture_idemp');
    expect(second.state).toBe('already-installed');
    expect(hookCalled).toBe(1);
  }, 60_000);
});
