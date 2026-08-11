import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T108-T111 (feature 027 US6) — Admin platform-wide carts surface.
 *
 * Exercises the four admin endpoints:
 *   - GET    /api/v1/admin/carts            (list, filter, sort)
 *   - GET    /api/v1/admin/carts/:id        (detail)
 *   - GET    /api/v1/admin/carts/:id/audit  (audit feed)
 *   - POST   /api/v1/admin/carts/:id/reject (terminal reject)
 *
 * Stub admin session = wildcard `*` permissions (set up by seedTestAdmins),
 * so `carts:read` and `carts:reject` both pass.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/carts', () => {
  let h: BackendServerHandle;
  let cartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Pre-seed one anonymous cart with a line so the list isn't empty.
    const em = h.em();
    const ch = await em.findOne(SalesChannel, { systemDefault: true });
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-admin-list-${Date.now()}`,
      salesChannelId: ch?.id ?? null,
    });
    await em.persistAndFlush(cart);
    cartId = cart.id;
    em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 2,
      unitPrice: '25.00',
      currency: 'PLN',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 401 from an unauthenticated session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/carts' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a paginated list for a stub admin session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/carts',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; status: string; itemCount: number }>;
      meta: { page: number; pageSize: number; totalCount: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBeGreaterThan(0);
    const ourRow = body.data.find((r) => r.id === cartId);
    expect(ourRow).toBeDefined();
    expect(ourRow?.status).toBe('active');
    expect(ourRow?.itemCount).toBe(1);
  });

  it('filters by status', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/carts?status=active',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    expect(body.data.every((r) => r.status === 'active')).toBe(true);
  });
});

describe('GET /api/v1/admin/carts/:id', () => {
  let h: BackendServerHandle;
  let cartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const ch = await em.findOne(SalesChannel, { systemDefault: true });
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-admin-detail-${Date.now()}`,
      salesChannelId: ch?.id ?? null,
    });
    await em.persistAndFlush(cart);
    cartId = cart.id;
    em.create(CartItem, {
      cartId: cart.id,
      productId: '00000000-0000-4000-8000-000000000101',
      quantity: 3,
      unitPrice: '12.00',
      currency: 'PLN',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the full detail including items and audit trail metadata', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/carts/${cartId}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        id: string;
        status: string;
        itemCount: number;
        total: { amount: number; currency: string };
        items: Array<{ quantity: number; unitPrice: { amount: number } }>;
      };
    };
    expect(body.data.id).toBe(cartId);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.quantity).toBe(3);
    expect(body.data.total.amount).toBeCloseTo(36, 2);
  });

  it('returns 404 for an unknown cart id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/carts/00000000-0000-4000-8000-000000000000',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/v1/admin/carts/:id/reject', () => {
  let h: BackendServerHandle;
  let activeCartId: string;
  let completedCartId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const ch = await em.findOne(SalesChannel, { systemDefault: true });
    const active = em.create(Cart, {
      anonymousCartToken: `anon-admin-reject-${Date.now()}`,
      salesChannelId: ch?.id ?? null,
    });
    const completed = em.create(Cart, {
      anonymousCartToken: `anon-admin-completed-${Date.now()}`,
      salesChannelId: ch?.id ?? null,
      status: 'completed',
    });
    await em.persistAndFlush([active, completed]);
    activeCartId = active.id;
    completedCartId = completed.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects an active cart with a reason', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/carts/${activeCartId}/reject`,
      cookies: ADMIN_COOKIE,
      payload: JSON.stringify({ reason: 'Out of budget for the quarter' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; rejectedReason: string | null; rejectedByActor: string | null };
    };
    expect(body.data.status).toBe('rejected');
    expect(body.data.rejectedReason).toBe('Out of budget for the quarter');
    expect(body.data.rejectedByActor).toContain('admin:');
  });

  it('refuses to reject an already-terminal cart', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/carts/${completedCartId}/reject`,
      cookies: ADMIN_COOKIE,
      payload: JSON.stringify({ reason: 'too late' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('requires a reason (Zod validation)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/carts/${activeCartId}/reject`,
      cookies: ADMIN_COOKIE,
      payload: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400); // Zod validation rejects → 400 VALIDATION_FAILED
  });
});

describe('GET /api/v1/admin/carts/:id/audit', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns an empty audit feed for a brand-new cart', async () => {
    const em = h.em();
    const ch = await em.findOne(SalesChannel, { systemDefault: true });
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-admin-audit-${Date.now()}`,
      salesChannelId: ch?.id ?? null,
    });
    await em.persistAndFlush(cart);

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/carts/${cart.id}/audit`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { totalCount: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.totalCount).toBe(0);
  });
});
