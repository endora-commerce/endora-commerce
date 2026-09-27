import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOM_FIELDS_CHANGED_CHANNEL,
  type CachedDefinition,
} from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js';

/**
 * The one cross-process invalidation path the platform has (feature 072, T073).
 *
 * Worth stating plainly, because it is easy to assume otherwise: the `EventBus`
 * is **in-process only** and the settings cache converges by TTL. Redis pub/sub
 * is the only mechanism by which a change made in one process reaches another
 * process's caches. Until this test it was exercised by nothing — the harness
 * ran a single Redis client, and ioredis will not accept ordinary commands on a
 * subscribed connection, so the path could not run at all.
 *
 * It is armed here and **only** here (`exercisePubSub`), for a measured reason:
 * subscribing costs roughly 10 MB per composition, a run performs 555 of them,
 * and arming it everywhere added ~1 GB to the suite's live set and turned the
 * full run into a heap OOM at file 182 of 940. One test that asserts the
 * behaviour is worth more than 555 compositions that merely carry it.
 */

let h: BackendServerHandle;

beforeAll(async () => {
  h = await setupBackendServer({ seed: 'none', exercisePubSub: true });
}, 120_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

/**
 * Every case starts from an empty cache, because boot is entitled to fill it.
 * The cache is one instance per composition and its entries live for
 * `CUSTOM_FIELDS_CACHE_TTL_MS`, so any install or boot hook that reads
 * definitions leaves a warm entry the first case runs into — `pim_ergonode`'s
 * attribute-key repair reads `product` past the cache on a fresh database, and
 * a warm `product` entry made the counting loader's first read a hit (0 calls,
 * not 1). Clearing locally touches no Redis traffic, so it cannot stand in for
 * the invalidation each case then asserts.
 */
beforeEach(() => {
  h.customFields.cache.invalidateLocal();
});

/** Give the subscriber's event-loop turn a chance to deliver the message. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * A counting loader. The cache is observed through *whether it reloads*,
 * because that is the only thing a consumer can see — `entries` is private, and
 * a test that reached into it would assert the implementation rather than the
 * behaviour the channel exists to produce.
 */
function countingLoader(): { load: () => Promise<CachedDefinition[]>; calls: () => number } {
  let calls = 0;
  return {
    load: async () => {
      calls += 1;
      return [];
    },
    calls: () => calls,
  };
}

describe('cross-process invalidation over Redis pub/sub', () => {
  it('drops the entity type an invalidation published by another process names', async () => {
    const cache = h.customFields.cache;
    const product = countingLoader();

    await cache.getForEntity('product', product.load);
    await cache.getForEntity('product', product.load);
    // Second read served from cache — otherwise the invalidation below would
    // prove nothing, since a cache that never hits always "reloads".
    expect(product.calls()).toBe(1);

    // Published on the MAIN client, standing in for a second process — which
    // is exactly the shape the channel exists for.
    await h.redis.publish(
      CUSTOM_FIELDS_CHANGED_CHANNEL,
      JSON.stringify({ entityType: 'product' }),
    );
    await settle();

    await cache.getForEntity('product', product.load);
    expect(product.calls()).toBe(2);
  });

  it('leaves unrelated entity types cached', async () => {
    const cache = h.customFields.cache;
    const organization = countingLoader();

    await cache.getForEntity('organization', organization.load);
    await h.redis.publish(
      CUSTOM_FIELDS_CHANGED_CHANNEL,
      JSON.stringify({ entityType: 'product' }),
    );
    await settle();

    // A channel that invalidated everything on every message would be a cache
    // that never hits — a quieter failure than a stale one, and a worse one.
    await cache.getForEntity('organization', organization.load);
    expect(organization.calls()).toBe(1);
  });

  it('drops everything when the payload cannot be read', async () => {
    const cache = h.customFields.cache;
    // A type no earlier case primed. The cache is cleared before each case,
    // but a distinct type keeps this case independent of that ordering.
    const customer = countingLoader();

    await cache.getForEntity('customer', customer.load);
    await cache.getForEntity('customer', customer.load);
    expect(customer.calls()).toBe(1);

    await h.redis.publish(CUSTOM_FIELDS_CHANGED_CHANNEL, 'not json');
    await settle();

    // Fail safe rather than fail quiet: an unreadable message means "something
    // changed and I cannot tell what", so the only correct answer is to drop
    // everything instead of continuing to serve what might be stale.
    await cache.getForEntity('customer', customer.load);
    expect(customer.calls()).toBe(2);
  });
});
