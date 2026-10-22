import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOM_FIELDS_CHANGED_CHANNEL,
  type CachedDefinition,
} from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js';
import {
  PRICING_GENERATION_CHANNEL,
  type PricingGeneration,
} from '../../../../packages/modules/price_lists/src/backend/services/pricing-generation.js';
import type { PriceBookService } from '../../../../packages/modules/price_lists/src/backend/services/price-book-service.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

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

/**
 * D-287 P0 — the pricing cache joins the cross-process path.
 *
 * `price_lists`' LRU was per process: a price write cleared the writer's copy
 * and no other, so every other API and worker replica served the old price for
 * up to the 60 s TTL (`specs/pricing/read-paths-and-performance.md` §2.4). The
 * module's boot hook now subscribes its `PricingGeneration` on the
 * composition's shared subscriber, and every write after commit — and every
 * status sweep that flips a list — announces a bump on
 * `PRICING_GENERATION_CHANNEL`.
 *
 * The harness runs the LRU with a zero TTL, so the cache itself holds nothing
 * to observe; what is observed is the composed process's handler receiving
 * another process's announcement, and the composed writer announcing its own.
 */
describe('cross-process pricing cache invalidation over Redis pub/sub', () => {
  function pricingGeneration(): PricingGeneration {
    return (
      h.container.cradle as unknown as {
        priceLists: { handle: { pricingGeneration: PricingGeneration } };
      }
    ).priceLists.handle.pricingGeneration;
  }

  it("clears this process's pricing cache when another process bumps the generation", async () => {
    const generation = pricingGeneration();
    const handled = vi.spyOn(generation, 'handleMessage');
    try {
      // Published on the MAIN client, standing in for a second process.
      await h.redis.publish(PRICING_GENERATION_CHANNEL, JSON.stringify({ origin: 'another-replica' }));
      await settle();
      expect(handled).toHaveBeenCalledWith(JSON.stringify({ origin: 'another-replica' }));
    } finally {
      handled.mockRestore();
    }
  });

  it('announces a bump after an audited price-book write commits', async () => {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    const listener = new Redis(url, { maxRetriesPerRequest: null });
    const received: string[] = [];
    try {
      await listener.subscribe(PRICING_GENERATION_CHANNEL);
      listener.on('message', (channel, message) => {
        if (channel === PRICING_GENERATION_CHANNEL) received.push(message);
      });
      const service = (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
        handle: { priceBookService: PriceBookService };
      }>('priceLists').handle.priceBookService;
      const channels = await h.em().getConnection().execute<Array<{ id: string }>>(
        `select "id" from "sales_channels" where "system_default" = true`,
      );
      await withSystemScope('cross-process bump test', () =>
        service.createBook({
          name: `Cross-process bump ${Date.now()}`,
          type: 'regular',
          currencyCode: 'PLN',
          channelIds: [channels[0]!.id],
          audience: { kind: 'everyone', memberIds: [] },
          priority: 0,
        }),
      );
      await settle();
      expect(received.length).toBeGreaterThanOrEqual(1);
    } finally {
      listener.removeAllListeners('message');
      await listener.unsubscribe();
      listener.disconnect();
    }
  });
});
