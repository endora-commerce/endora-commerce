import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  ModuleRegistryCache,
  STATE_CHANGED_CHANNEL,
} from '../../../src/kernel/lifecycle/registry-cache.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleRegistration } from '@endora-commerce/platform/composition';

/**
 * Integration test for the cache-refresh path on Redis pub/sub
 * (US3 / data-model "Redis state").
 *
 * Two cache instances simulate two backend processes. Process A
 * publishes on `b2b:module:state-changed`; Process B's cache must
 * observe the change, through the notification.
 *
 * **What is waited for is the end state, not a wall clock** (issue #250). The
 * case used to poll for one second, and a loaded machine — a slow Redis
 * delivery, a slow `refreshFromDb` — made it red while the refresh was right.
 * It now waits for the refresh the notification starts to finish, which is the
 * moment the answer is decided, and then asserts it. A notification that is
 * never delivered still fails, on the case's own timeout. That the refresh came
 * from the notification and not from the degraded-mode timer is asserted
 * directly: the cache is not degraded, so no such timer exists. The cache
 * subscribes only on a client that has finished its handshake, see
 * {@link ready}: one that had not could lose the notification outright.
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
    await Promise.all([ready(publisher), ready(subscriberRedis)]);
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

  it('cacheB observes a state-change published by another process, through the notification', async () => {
    expect(cacheB.isEnabled('fixture_pubsub')).toBe(true);
    // Subscribed, so no degraded-mode timer exists: the only refresh that can
    // run below is the one the notification starts.
    expect(cacheB.isDegraded()).toBe(false);

    // The end state is "a refresh that started after the flip has finished".
    // The channel is shared with every other run on this Redis, so a refresh
    // started by somebody else's notification may come first; one that started
    // before the flip read the old row and decides nothing.
    const original = cacheB.refreshFromDb.bind(cacheB);
    let flipped = false;
    let refreshed!: () => void;
    const refreshDone = new Promise<void>((resolve) => {
      refreshed = resolve;
    });
    const refresh = vi.spyOn(cacheB, 'refreshFromDb').mockImplementation(async (em) => {
      const afterFlip = flipped;
      await original(em);
      if (afterFlip) refreshed();
    });

    try {
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
      flipped = true;
      await publisher.publish(
        STATE_CHANGED_CHANNEL,
        JSON.stringify({ moduleId: 'fixture_pubsub', newState: 'disabled' }),
      );

      await refreshDone;

      expect(refresh).toHaveBeenCalled();
      expect(cacheB.isDegraded()).toBe(false);
      expect(cacheB.isEnabled('fixture_pubsub')).toBe(false);
    } finally {
      refresh.mockRestore();
    }
  }, 30_000);
});

/**
 * Resolve once `client` has finished its handshake (issue #250).
 *
 * ioredis writes a `SUBSCRIBE` issued between the socket's `connect` and its
 * `ready` straight to the wire, because Redis lets pub/sub run while it is
 * loading. If the reply lands before the ready check's `INFO` is sent, the
 * connection is already in subscriber mode, the `INFO` is refused ("Connection
 * in subscriber mode, only subscriber commands may be used"), and ioredis
 * drops and re-opens the socket. A notification published while it is
 * reconnecting is delivered to nobody. On an idle machine the handshake is
 * long over before the case subscribes; on a loaded one it is not, and the
 * case went red with the code under test right.
 */
async function ready(client: Redis): Promise<void> {
  if (client.status === 'ready') return;
  await once(client, 'ready');
}
