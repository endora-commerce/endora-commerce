import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * T033 (feature 027 US1 / FR-032) — `last_activity_at` bookkeeping.
 *
 * Bumped by:
 *   - add line (POST /api/v1/cart/items)
 *   - update qty (PATCH /api/v1/cart/items/:id)
 *   - remove line (DELETE /api/v1/cart/items/:id)
 *   - explicit page-open ping (POST /api/v1/cart/touch)
 *
 * NOT bumped by:
 *   - GET /api/v1/cart (read-only inspection)
 *
 * Each "bump" is verified by re-loading the cart row from the EntityManager
 * after a 20 ms wait so the timestamp can advance.
 */

async function readLastActivityAt(h: BackendServerHandle, cartId: string): Promise<Date> {
  const em = h.em();
  const cart = await em.findOneOrFail(Cart, { id: cartId });
  return cart.lastActivityAt;
}

async function pause(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('cart last_activity_at bookkeeping', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('bumps last_activity_at on add, update, remove, and touch — but NOT on a passive GET', async () => {
    const anonToken = `anon-lastact-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);
    const cartId = (add.json() as { data: { id: string; items: { id: string }[] } }).data.id;
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const afterAdd = await readLastActivityAt(h, cartId);

    // GET — should NOT bump.
    await pause();
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const afterGet = await readLastActivityAt(h, cartId);
    expect(afterGet.getTime()).toBe(afterAdd.getTime());

    // PATCH qty=3 — should bump.
    await pause();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 3 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const afterPatch = await readLastActivityAt(h, cartId);
    expect(afterPatch.getTime()).toBeGreaterThan(afterGet.getTime());

    // TOUCH — should bump.
    await pause();
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/touch',
      cookies: { b2b_cart_anon: anonToken },
    });
    const afterTouch = await readLastActivityAt(h, cartId);
    expect(afterTouch.getTime()).toBeGreaterThan(afterPatch.getTime());

    // DELETE — should bump.
    await pause();
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: { b2b_cart_anon: anonToken },
    });
    const afterDelete = await readLastActivityAt(h, cartId);
    expect(afterDelete.getTime()).toBeGreaterThan(afterTouch.getTime());

    // Second PATCH on a now-empty cart would fail (no item) — so verify a
    // POST-add instead.
    await pause();
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const afterReAdd = await readLastActivityAt(h, cartId);
    expect(afterReAdd.getTime()).toBeGreaterThan(afterDelete.getTime());
  });
});
