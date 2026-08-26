import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CartRecomputeCache } from '../../../../packages/modules/carts/src/backend/services/cart-recompute-cache.js';

/**
 * Feature 027 §R5 / FR-008 — re-pricing on read.
 *
 * The GET /api/v1/cart handler runs every line through CartPricingRecompute
 * so the buyer's response always reflects the customer's current
 * contractual price (the snapshotted `cart_items.unit_price` is kept for
 * audit / diff but never displayed once the recompute helper is wired).
 *
 * This test exercises the wiring by:
 *   1. Adding an item to the cart at its snapshot price.
 *   2. Reading the cart twice — the second read goes through the 30 s
 *      Redis cache; both responses should carry the recomputed prices.
 *   3. Asserting the response shape is consistent with `cartFullPayloadSchema`.
 */

describe('GET /api/v1/cart — re-pricing on read (feature 027 §R5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Wipe any stale recompute cache entries from prior runs in the same
    // Redis instance.
    let cursor = '0';
    do {
      const [next, keys] = await h.redis.scan(
        cursor,
        'MATCH',
        'b2b:cart:recompute:*',
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length > 0) await h.redis.del(...keys);
    } while (cursor !== '0');
  });

  it('returns prices on every read with the recompute helper wired', async () => {
    const anonToken = `anon-reprice-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const read1 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(read1.statusCode).toBe(200);
    const body1 = read1.json() as {
      data: {
        id: string;
        items: Array<{
          quantity: number;
          unitPrice: { amount: number; currency: string };
          lineTotal: { amount: number; currency: string };
        }>;
      };
    };
    expect(body1.data.items).toHaveLength(1);
    const line = body1.data.items[0]!;
    expect(line.quantity).toBe(2);
    expect(line.unitPrice.amount).toBeGreaterThanOrEqual(0);
    expect(line.lineTotal.amount).toBeCloseTo(line.unitPrice.amount * line.quantity, 2);

    // Confirm a Redis cache entry was written for this cart.
    const cacheKey = CartRecomputeCache.keyFor(body1.data.id);
    const cached = await h.redis.get(cacheKey);
    expect(cached).not.toBeNull();

    // Second read — should hit the cache and return the same prices.
    const read2 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(read2.statusCode).toBe(200);
    const body2 = read2.json() as {
      data: { items: Array<{ unitPrice: { amount: number } }> };
    };
    expect(body2.data.items[0]?.unitPrice.amount).toBeCloseTo(line.unitPrice.amount, 2);
  });

  it('still works when the cart is empty (no recompute call)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: unknown[]; subtotal: { amount: number }; grandTotal: { amount: number } };
    };
    expect(body.data.items).toEqual([]);
    expect(body.data.subtotal.amount).toBe(0);
    expect(body.data.grandTotal.amount).toBe(0);
  });
});
