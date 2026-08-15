import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  ModuleRegistryCache,
  STATE_CHANGED_CHANNEL,
} from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';

/**
 * Integration test for the cache-refresh path on Redis pub/sub
 * (US3 / data-model "Redis state").
 *
 * Two cache instances simulate two backend processes. Process A
 * publishes on `b2b:module:state-changed`; Process B's cache must
 * observe the change within 1 second.
 */

describe('ModuleRegistryCache — pub/sub refresh between processes (integration)', () => {
  let db: TestDb;
  let publisher: Redis;
  let subscriberRedis: Redis;
  let cacheB: ModuleRegistryCache;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    publisher = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    subscriberRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

    // Seed an installed row that cacheB should pick up after refresh.
    const em = db.orm.em.fork();
    await em.nativeDelete(ModuleRegistration, { moduleId: 'fixture_pubsub' });
    em.create(ModuleRegistration, {
      moduleId: 'fixture_pubsub',
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    cacheB = new ModuleRegistryCache();
    // Feature 072 (D-38) — the two halves a process runs in order: `load()`
    // reads PostgreSQL and is fatal, `watch()` arms the pub/sub side and is not.
    await cacheB.load({ em: () => db.orm.em.fork() as never });
    await cacheB.watch({
      redisSubscriber: subscriberRedis,
      em: () => db.orm.em.fork() as never,
    });
  }, 60_000);

  afterAll(async () => {
    // Feature 073 — a dropped subscriber arms a degraded-mode refresh timer.
    // Disconnecting below fires `'end'`, so the timer must be stopped or it
    // outlives this file and polls a closed ORM for the rest of the fork.
    cacheB.stopFallbackRefresh();
    await db.orm.em.fork().nativeDelete(ModuleRegistration, { moduleId: 'fixture_pubsub' });
    publisher.disconnect();
    subscriberRedis.disconnect();
    await db.close();
  });

  it('cacheB observes a state-change published by another process within 1 s', async () => {
    expect(cacheB.isEnabled('fixture_pubsub')).toBe(true);

    // Process A flips the row to disabled and publishes a state-change.
    const em = db.orm.em.fork();
    const row = await em.findOne(ModuleRegistration, {
      moduleId: 'fixture_pubsub',
    });
    if (row) {
      row.state = 'disabled';
      row.lastStateChangeAt = new Date();
      await em.flush();
    }
    await publisher.publish(
      STATE_CHANGED_CHANNEL,
      JSON.stringify({ moduleId: 'fixture_pubsub', newState: 'disabled' }),
    );

    // Wait up to 1 s for cacheB to refresh.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (!cacheB.isEnabled('fixture_pubsub')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(cacheB.isEnabled('fixture_pubsub')).toBe(false);
  }, 30_000);
});
