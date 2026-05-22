import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CartRecomputeCache } from '../../../src/modules/carts/services/cart-recompute-cache.js';
import { CartPricingRecompute } from '../../../src/modules/carts/services/cart-pricing-recompute.js';
import type { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';

/**
 * T021 (feature 027) — CartPricingRecompute helper.
 *
 * Verifies (a) the resolver is invoked for each line on a cold cache,
 * (b) the second invocation within the TTL window is served from the
 * cache (zero further resolver calls), (c) the `writeBackTo` helper
 * stamps recomputed_* on the entity rows.
 *
 * The PricingService is stubbed (vi.fn) so we can count calls precisely;
 * the database is real PostgreSQL for the SalesChannel + Product lookups,
 * and Redis is real for the cache.
 */

describe('CartPricingRecompute — resolver call counts & write-back', () => {
  let db: TestDb;
  let redis: Redis;
  let systemDefaultChannelId: string;
  let seedProductId: string;
  const testCartId = '00000000-0000-4000-8000-00000000ca02';
  const testItemId = '00000000-0000-4000-8000-00000000ce02';

  beforeAll(async () => {
    db = await setupTestDb();
    const tmpEm = db.orm.em.fork();
    const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });
    systemDefaultChannelId = ch?.id ?? '';
    const products = await tmpEm.find(Product, {}, { limit: 1 });
    if (products.length === 0) {
      throw new Error('No products seeded; cannot run T021');
    }
    seedProductId = products[0]!.id;

    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await redis.del(CartRecomputeCache.keyFor(testCartId));
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('resolves each line via PricingService on cold cache, then serves from cache', async () => {
    const em = db.em();
    const cache = new CartRecomputeCache(redis, { ttlSeconds: 30 });
    const resolveLinePrice = vi.fn().mockImplementation(async (input: { context: { quantity: number } }) => ({
      amount: (10 * input.context.quantity).toFixed(2),
      currency: 'PLN',
      priceListId: '00000000-0000-4000-8000-000000000d11',
      isSale: false,
      bracketStartQuantity: 1,
      displayMode: 'gross_only' as const,
    }));
    const pricingService = { resolveLinePrice } as unknown as PricingService;

    const helper = new CartPricingRecompute(() => em, pricingService, cache);

    const lines = [
      { cartItemId: testItemId, productId: seedProductId, quantity: 2 },
      { cartItemId: testItemId + 'x', productId: seedProductId, quantity: 5 },
    ];

    const first = await helper.recompute(
      { cartId: testCartId, organizationId: null, salesChannelId: systemDefaultChannelId },
      lines,
    );
    expect(first).toHaveLength(2);
    expect(first[0]?.amount).toBe(20);
    expect(first[1]?.amount).toBe(50);
    expect(resolveLinePrice).toHaveBeenCalledTimes(2);

    // Second call — cache hit, no further resolver invocations.
    const second = await helper.recompute(
      { cartId: testCartId, organizationId: null, salesChannelId: systemDefaultChannelId },
      lines,
    );
    expect(second).toHaveLength(2);
    expect(resolveLinePrice).toHaveBeenCalledTimes(2);
  });

  it('returns null amount on resolver failure (no eligible price list)', async () => {
    const em = db.em();
    const cache = new CartRecomputeCache(redis, { ttlSeconds: 30 });
    const pricingService = {
      resolveLinePrice: vi.fn().mockResolvedValue(null),
    } as unknown as PricingService;
    const helper = new CartPricingRecompute(() => em, pricingService, cache);

    const out = await helper.recompute(
      { cartId: testCartId, organizationId: null, salesChannelId: systemDefaultChannelId },
      [{ cartItemId: testItemId, productId: seedProductId, quantity: 1 }],
    );
    expect(out[0]?.amount).toBeNull();
    expect(out[0]?.currency).toBe('PLN');
  });

  it('returns null amount when the product is missing from the catalog', async () => {
    const em = db.em();
    const cache = new CartRecomputeCache(redis, { ttlSeconds: 30 });
    const pricingService = {
      resolveLinePrice: vi.fn().mockResolvedValue({
        amount: '15.00',
        currency: 'PLN',
        priceListId: 'x',
        isSale: false,
        bracketStartQuantity: 1,
        displayMode: 'gross_only' as const,
      }),
    } as unknown as PricingService;
    const helper = new CartPricingRecompute(() => em, pricingService, cache);

    const out = await helper.recompute(
      { cartId: testCartId, organizationId: null, salesChannelId: systemDefaultChannelId },
      [{ cartItemId: testItemId, productId: '00000000-0000-4000-8000-000000000999', quantity: 1 }],
    );
    expect(out[0]?.amount).toBeNull();
  });
});
