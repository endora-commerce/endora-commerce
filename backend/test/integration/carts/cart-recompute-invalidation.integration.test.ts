import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CartRecomputeCache } from '../../../src/modules/carts/services/cart-recompute-cache.js';

/**
 * T031 (feature 027 §R5 — partial coverage).
 *
 * Verifies the cart-side write invariant from data-model.md:
 * "Cleared on every cart-side write" — every add/update/remove
 * invalidates the per-cart price recompute cache so the next read
 * goes back through the resolver instead of serving a stale price.
 *
 * Verified end-to-end via the storefront routes:
 *   1. add a line via the route — populates the cache during the
 *      response's serialization
 *   2. assert the Redis key is present
 *   3. add another line — invalidate hook fires
 *   4. assert the key is absent (the next GET will repopulate)
 *
 * Full T031 ("price-list edit between two reads shows the new price")
 * requires deeper price-list scaffolding and is left for a future
 * iteration once the price-list test helpers grow a "set product
 * price" shortcut. This test covers the cache-invalidation half of
 * the FR-008 guarantee.
 */

describe('CartService — recompute cache invalidation on cart-side writes', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('invalidates the per-cart recompute cache on every mutation', async () => {
    const anonToken = `anon-invalidate-${Date.now()}`;
    // First add — opens the cart.
    const add1 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add1.statusCode).toBe(200);
    const cartId = (add1.json() as { data: { id: string } }).data.id;

    // First GET — populates the cache.
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const keyPresentAfterRead = await h.redis.get(CartRecomputeCache.keyFor(cartId));
    expect(keyPresentAfterRead).not.toBeNull();

    // Second add — should invalidate the cache.
    const add2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000102', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add2.statusCode).toBe(200);

    const keyAfterMutation = await h.redis.get(CartRecomputeCache.keyFor(cartId));
    expect(keyAfterMutation).toBeNull();
  });

  it('invalidates the cache on PATCH and DELETE too', async () => {
    const anonToken = `anon-invalidate-2-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const cartId = (add.json() as { data: { id: string; items: { id: string }[] } }).data.id;
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(await h.redis.get(CartRecomputeCache.keyFor(cartId))).not.toBeNull();

    // PATCH invalidates.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 5 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(await h.redis.get(CartRecomputeCache.keyFor(cartId))).toBeNull();

    // Repopulate.
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(await h.redis.get(CartRecomputeCache.keyFor(cartId))).not.toBeNull();

    // DELETE invalidates.
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(await h.redis.get(CartRecomputeCache.keyFor(cartId))).toBeNull();
  });
});
