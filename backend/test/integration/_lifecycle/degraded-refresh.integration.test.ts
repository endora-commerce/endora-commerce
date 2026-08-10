import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import {
  FALLBACK_TTL_MS,
  ModuleRegistryCache,
} from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleRegistration } from '../../../src/modules/_lifecycle/entities/module-registration.entity.js';

/**
 * Feature 073 / research R-2b — the degraded-mode refresh.
 *
 * Before this feature `FALLBACK_TTL_MS` governed `maybeRefresh`, which had
 * **zero call sites**, and `isEnabled` never consulted `degraded`. A process
 * whose subscriber connection dropped therefore served a permanently stale
 * enabled-set until ioredis reconnected *and* somebody published.
 *
 * This test drives that exact case: drop the subscriber, change the registry
 * behind the cache's back, publish nothing at all, and require the cache to
 * recover a correct enabled-set on its own.
 *
 * It also pins the semantics of "fail closed": degraded means **stale**, not
 * "everything is off". PostgreSQL is the authority and stays reachable during
 * a Redis outage, so blanking the set would take the platform down on a blip.
 */

const MODULE_ID = 'fixture_degraded';

describe('ModuleRegistryCache — degraded-mode refresh without a publish (integration)', () => {
  let db: TestDb;
  let publisher: Redis;
  let subscriberRedis: Redis;
  let cache: ModuleRegistryCache;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    publisher = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    subscriberRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

    const em = db.orm.em.fork();
    await em.nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    em.create(ModuleRegistration, {
      moduleId: MODULE_ID,
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    cache = new ModuleRegistryCache();
    await cache.start({
      redis: publisher,
      redisSubscriber: subscriberRedis,
      em: () => db.orm.em.fork() as never,
    });
  }, 60_000);

  afterAll(async () => {
    cache.stopFallbackRefresh();
    await db.orm.em.fork().nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    publisher.disconnect();
    subscriberRedis.disconnect();
    await db.close();
  });

  it('recovers a correct enabled-set after the subscriber drops, with no publish', async () => {
    expect(cache.isEnabled(MODULE_ID)).toBe(true);
    expect(cache.isDegraded()).toBe(false);

    // The subscriber connection dies. Nothing tells the cache what changed.
    subscriberRedis.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cache.isDegraded()).toBe(true);

    // Stale, not blank: an outage on the notification channel must not read
    // as "every module is off".
    expect(cache.isEnabled(MODULE_ID)).toBe(true);

    // Another process disables the module. No publish reaches us.
    const em = db.orm.em.fork();
    const row = await em.findOne(ModuleRegistration, { moduleId: MODULE_ID });
    if (!row) throw new Error('fixture registration row disappeared');
    row.state = 'disabled';
    row.lastStateChangeAt = new Date();
    await em.flush();

    // The background timer must notice within a couple of fallback windows.
    const deadline = Date.now() + FALLBACK_TTL_MS * 2 + 1_000;
    while (Date.now() < deadline && cache.isEnabled(MODULE_ID)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(cache.isEnabled(MODULE_ID)).toBe(false);

    // A successful refresh clears the degraded flag again.
    expect(cache.isDegraded()).toBe(false);
  }, 30_000);
});
