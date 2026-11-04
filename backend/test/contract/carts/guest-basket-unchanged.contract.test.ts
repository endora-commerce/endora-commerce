import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';

/**
 * The guest basket is unchanged by `carts.create` (`specs/170-organization-roles/`
 * WP-04, T121; owner ruling PR-4; research R-35; FR-030).
 *
 * `carts.create` judges a **signed-in** customer only. The routes that admit a
 * guest today take the guard with `{ guests: 'pass' }`: an anonymous visitor
 * adds to, edits and applies a coupon to the guest basket exactly as before —
 * `200`, and the anonymous cookie minted on the first add. The same `POST`
 * from a signed-in member whose role lacks the code is refused `403`.
 *
 * Written before the gates and green on both sides of them for the guest; the
 * last case is the one the gates turn green.
 */

const ANON_COOKIE = 'b2b_cart_anon';

describe('the guest basket under carts.create (PR-4)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, {
      label: 'WP-04 guest basket',
      members: { RESTRICTED: { permissions: [] } },
      channels: ['default'],
    });
  }, 60_000);

  afterAll(async () => {
    org?.release();
    await teardownBackendServer(h);
  });

  it('an anonymous visitor adds a line: 200, and the anonymous cookie is minted', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const minted = res.cookies.find((cookie) => cookie.name === ANON_COOKIE);
    expect(minted?.value, 'the anonymous cookie').toMatch(/^anon-/);
    expect((res.json() as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });

  it('edits, removes, applies and clears a coupon on the guest basket as today', async () => {
    const token = `anon-wp04-guest-${randomUUID()}`;
    const cookies = { [ANON_COOKIE]: token };
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies,
    });
    expect(add.statusCode, add.body).toBe(200);
    const itemId = (add.json() as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 3 },
      cookies,
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect((patch.json() as { data: { items: Array<{ quantity: number }> } }).data.items[0]?.quantity).toBe(3);

    // An unknown code is refused by the coupon engine, as it is today — the
    // guard let the guest through to it.
    const coupon = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'NO-SUCH-CODE-WP04' },
      cookies,
    });
    expect(coupon.statusCode, coupon.body).toBe(422);
    expect((coupon.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CART_COUPON_REJECTED);

    const clear = await h.app.inject({ method: 'DELETE', url: '/api/v1/cart/coupon', cookies });
    expect(clear.statusCode, clear.body).toBe(200);

    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/cart/items/${itemId}`, cookies });
    expect(del.statusCode, del.body).toBe(200);
    expect((del.json() as { data: { items: unknown[] } }).data.items).toEqual([]);

    const read = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
    expect(read.statusCode, read.body).toBe(200);
  });

  it('GET /api/v1/cart answers a visitor with no cookie at all', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('the same POST from a signed-in member lacking carts.create is refused 403', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_session: org.actors['RESTRICTED']!.cookie },
    });
    expect(res.statusCode, res.body).toBe(403);
    const { error } = res.json() as { error: { code: string; details?: { permission?: string } } };
    expect(error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect(error.details?.permission).toBe('carts.create');
    expect(res.cookies.find((cookie) => cookie.name === ANON_COOKIE)).toBeUndefined();
  });
});
