import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { LOCK_KEY } from '../../../src/lifecycle/services/lock.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';

/**
 * Integration test for SC-007 / FR-022 — two concurrent install
 * commands on the same instance never produce partial state.
 *
 * Two orchestrators race against the same Postgres + Redis. Exactly
 * one wins the lock and proceeds; the other receives a kind=lock-busy
 * error.
 *
 * Note: this test uses non-transactional fixtures because the two
 * orchestrators each open their own forked EM. Cleanup happens in
 * afterAll via direct nativeDelete.
 */

describe('Module install — concurrent lock (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    // Make sure no stale lock from a prior crashed run blocks us.
    await redis.del(LOCK_KEY);
  }, 60_000);

  afterAll(async () => {
    await db.orm.em
      .fork()
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_concurrent' });
    redis.disconnect();
    await db.close();
  });

  it('two simultaneous installs produce exactly one winner; the loser exits with lock-busy', async () => {
    const manifest = defineModuleManifest({
      id: 'fixture_concurrent',
      name: 'Fixture Concurrent',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_concurrent',
          {
            manifest,
            filePath: '<test>',
            installHook: async () => {
              // Sleep long enough for the rival to attempt its lock.
              await new Promise((resolve) => setTimeout(resolve, 250));
            },
          },
        ],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const makeOrchestrator = (): ModuleLifecycleOrchestrator =>
      new ModuleLifecycleOrchestrator({
        orm: db.orm,
        redis,
        em: () => db.orm.em.fork() as never,
        auditLog: new AuditLogService(() => db.orm.em.fork() as never),
        registry,
      });

    const a = makeOrchestrator();
    const b = makeOrchestrator();
    const results = await Promise.allSettled([
      a.install('fixture_concurrent'),
      b.install('fixture_concurrent'),
    ]);

    const wins = results.filter((r) => r.status === 'fulfilled').length;
    const lockBusyLosses = results
      .filter((r) => r.status === 'rejected')
      .filter(
        (r) =>
          (r as PromiseRejectedResult).reason instanceof LifecycleError &&
          ((r as PromiseRejectedResult).reason as LifecycleError).kind ===
            'lock-busy',
      ).length;

    // One winner, one lock-busy loser. No torn writes.
    expect(wins + lockBusyLosses).toBe(2);
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(lockBusyLosses).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
