import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * T030 (feature 027 US1) — full cart-loop integration walk.
 *
 * Exercises the spec's quickstart §2 end-to-end via the storefront
 * routes:
 *   1. POST add product A — cart created, single line, qty=1
 *   2. GET cart (full) — line list + grand total + primaryCta=checkout
 *   3. PATCH qty=4 — line total + grand total recompute
 *   4. POST add product B — itemCount=2
 *   5. DELETE product A — itemCount=1, cart still active
 *   6. Simulate checkout: flip cart.status to 'completed' directly via
 *      the EntityManager (mimicking what `OrderService.placeOrder` does
 *      at the end of a successful checkout)
 *   7. GET cart — buyer gets a fresh empty active cart (lazy-create
 *      via getOrCreateForAnon since the old one is terminal)
 */

describe('cart loop — add / view / patch / remove / completed', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('walks the full buyer-side US1 cart loop end-to-end', async () => {
    const anonToken = `anon-loop-${Date.now()}`;

    // 1) Add product A.
    const add1 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add1.statusCode).toBe(200);
    const add1Body = add1.json() as {
      data: { id: string; itemCount: number; items: Array<{ id: string }> };
    };
    expect(add1Body.data.itemCount).toBe(1);
    const cartId = add1Body.data.id;
    const itemAId = add1Body.data.items[0]!.id;

    // 2) GET full payload — primaryCta=checkout, grandTotal matches subtotal.
    const view = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(view.statusCode).toBe(200);
    const viewBody = view.json() as {
      data: {
        status: string;
        approvalStatus: string;
        primaryCta: string;
        subtotal: { amount: number };
        grandTotal: { amount: number };
        items: Array<{ unitPrice: { amount: number } }>;
      };
    };
    expect(viewBody.data.status).toBe('active');
    expect(viewBody.data.approvalStatus).toBe('not_required');
    expect(viewBody.data.primaryCta).toBe('checkout');
    expect(viewBody.data.grandTotal.amount).toBeCloseTo(viewBody.data.subtotal.amount, 2);

    // 3) PATCH qty=4 — line total + grand total recompute.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemAId}`,
      payload: { quantity: 4 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(patch.statusCode).toBe(200);
    const patchBody = patch.json() as {
      data: { items: Array<{ quantity: number; lineTotal: { amount: number } }>; grandTotal: { amount: number } };
    };
    expect(patchBody.data.items[0]?.quantity).toBe(4);
    expect(patchBody.data.grandTotal.amount).toBeCloseTo(patchBody.data.items[0]!.lineTotal.amount, 2);

    // 4) Add product B.
    const add2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000102', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add2.statusCode).toBe(200);
    const add2Body = add2.json() as { data: { itemCount: number } };
    expect(add2Body.data.itemCount).toBe(2);

    // 5) DELETE product A.
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemAId}`,
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(del.statusCode).toBe(200);
    const delBody = del.json() as { data: { itemCount: number; status: string } };
    expect(delBody.data.itemCount).toBe(1);
    expect(delBody.data.status).toBe('active');

    // 6) Simulate checkout — flip status to 'completed' and clear the
    //    anon token (the latter is what `CartService.mergeAnonymousIntoCustomer`
    //    does after a non-empty merge; OrderService.placeOrder follows the
    //    same release-the-token convention so the next anon session can
    //    open a fresh cart under the same cookie).
    const em = h.em();
    const cart = await em.findOneOrFail(Cart, { id: cartId });
    cart.status = 'completed';
    cart.anonymousCartToken = null;
    await em.flush();

    // 7) GET cart — buyer should get a fresh empty active cart on the next
    //    storefront visit (lazy-create via getOrCreateForAnon).
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as { data: { id: string | null; status: string; itemCount: number } };
    expect(afterBody.data.status).toBe('active');
    expect(afterBody.data.itemCount).toBe(0);
    expect(afterBody.data.id).not.toBe(cartId);
  });
});
