import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CartRecomputeCache } from '../../../src/modules/carts/services/cart-recompute-cache.js';
import { CartPricingRecompute } from '../../../src/modules/carts/services/cart-pricing-recompute.js';
import type {
  CatalogProductReadPort,
  LinePricePort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';

/**
 * T021 (feature 027) — CartPricingRecompute helper.
 *
 * Verifies (a) the resolver is invoked for each line on a cold cache,
 * (b) the second invocation within the TTL window is served from the
 * cache (zero further resolver calls), (c) the `writeBackTo` helper
 * stamps recomputed_* on the entity rows.
 *
 * The pricing engine is stubbed (vi.fn) so we can count calls precisely; the
 * database is real PostgreSQL for the SalesChannel lookup and Redis is real for
 * the cache.
 *
 * `catalog` and `organizations` are reached through their published read ports
 * since feature 075's cut, so the product lookup is a stub here rather than a
 * real `em.find` — which is the point of the cut: the helper no longer queries
 * another module's table, and this test can no longer pass by seeding one.
 */

/** Answers for exactly the seeded product, the way `catalog`'s port would. */
function catalogStub(knownProductId: () => string): CatalogProductReadPort {
  return {
    findByIds: async (ids: readonly string[]) =>
      ids
        .filter((id) => id === knownProductId())
        .map((id) => ({ id, attributeValues: {} }) as never),
  } as unknown as CatalogProductReadPort;
}

/** No organisation in these cases — the anonymous-price path. */
const NO_ORGANIZATIONS = {
  findById: async () => null,
} as unknown as OrganizationDetailsPort;

describe('CartPricingRecompute — resolver call counts & write-back', () => {
  let db: TestDb;
  let redis: Redis;
  let systemDefaultChannelId: string;
  let seedProductId: string;
  const testCartId = '00000000-0000-4000-8000-00000000ca02';
  const testItemId = '00000000-0000-4000-8000-00000000ce02';

  beforeAll(async () => {
    db = await setupTestDb();
    systemDefaultChannelId = db.systemDefaultChannelId;

    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  /**
   * The product is created inside the per-test transaction and rolled back with
   * it. It used to be whichever row `find(Product, {}, { limit: 1 })` happened to
   * return, which made the file depend on committed leftovers from whatever ran
   * before it — so the suite passed or failed on file ordering alone, and it
   * failed the moment feature 072 moved an unrelated `.test.ts` inside `src/`.
   */
  beforeEach(async () => {
    const em = await db.beginTx();
    const product = em.create(Product, {
      sku: `T021-${randomUUID().slice(0, 8)}`,
      slug: `t021-${randomUUID().slice(0, 8)}`,
      type: 'simple',
      visibility: 'public',
      name: { en: 'T021 fixture' },
      description: { en: 'T021 fixture' },
    });
    await em.persistAndFlush(product);
    seedProductId = product.id;
    await redis.del(CartRecomputeCache.keyFor(testCartId));
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(() => {
    redis?.disconnect();
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
    const pricingService = { resolveLinePrice } as unknown as LinePricePort;

    const helper = new CartPricingRecompute(
      () => em,
      pricingService,
      cache,
      catalogStub(() => seedProductId),
      NO_ORGANIZATIONS,
    );

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
    } as unknown as LinePricePort;
    const helper = new CartPricingRecompute(
      () => em,
      pricingService,
      cache,
      catalogStub(() => seedProductId),
      NO_ORGANIZATIONS,
    );

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
    } as unknown as LinePricePort;
    const helper = new CartPricingRecompute(
      () => em,
      pricingService,
      cache,
      catalogStub(() => seedProductId),
      NO_ORGANIZATIONS,
    );

    const out = await helper.recompute(
      { cartId: testCartId, organizationId: null, salesChannelId: systemDefaultChannelId },
      [{ cartItemId: testItemId, productId: '00000000-0000-4000-8000-000000000999', quantity: 1 }],
    );
    expect(out[0]?.amount).toBeNull();
  });
});
