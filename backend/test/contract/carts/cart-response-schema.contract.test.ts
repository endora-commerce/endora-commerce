import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminCartDetailResponseSchema,
  adminCartsListResponseSchema,
  cartFullResponseSchema,
  cartMiniResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** Strict copies: a key a route answers that the contract does not declare fails. */
const strictFull = deepStrict(cartFullResponseSchema);
const strictMini = deepStrict(cartMiniResponseSchema);
const strictAdminList = deepStrict(adminCartsListResponseSchema);
const strictAdminDetail = deepStrict(adminCartDetailResponseSchema);

/**
 * The cart routes answer what `@endora-commerce/contracts` publishes, and
 * nothing beside it (Constitution II, issue #128).
 *
 * Each reply is driven through the real HTTP stack and parsed with a **strict
 * copy** of the published schema (`test/helpers/strict-schema.ts`), so both a
 * declared field the reply answers with a type the schema refuses — `null`
 * where the schema says "a string, or absent" — and a key the reply carries
 * that no schema declares red this file. The empty basket and a basket with a
 * line are both read: the empty one is a hand-built literal in the route, not
 * the serialiser, and drifts on its own.
 */
describe('cart responses parse with the published cart schemas', () => {
  let h: BackendServerHandle;
  const anon = { cookies: { b2b_cart_anon: `anon-128-${Date.now()}` } };
  let added: unknown;
  let cartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      ...anon,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    expect(res.statusCode).toBe(200);
    added = res.json();
    cartId = (added as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /api/v1/cart — the empty basket', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart' });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictFull, res.json())).toEqual([]);
  });

  it('GET /api/v1/cart — a basket with a line', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', ...anon });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictFull, res.json())).toEqual([]);
  });

  it('POST /api/v1/cart/items — the mutation reply', () => {
    expect(disagreements(strictFull, added)).toEqual([]);
  });

  it('GET /api/v1/cart?view=mini — the empty mini basket', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart?view=mini' });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictMini, res.json())).toEqual([]);
  });

  it('GET /api/v1/cart?view=mini — a mini basket with a line', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart?view=mini', ...anon });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictMini, res.json())).toEqual([]);
  });

  it('GET /api/v1/admin/carts — the admin list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/carts', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.map((c) => c.id)).toContain(cartId);
    expect(disagreements(strictAdminList, body)).toEqual([]);
  });

  it('GET /api/v1/admin/carts/:id — the admin detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/carts/${cartId}`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictAdminDetail, res.json())).toEqual([]);
  });
});
