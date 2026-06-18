import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 / US1 — promotions CRUD contract: create an action-based
 * promotion with a typed rule, read it back, list the action catalogue, and
 * preview application against a cart snapshot.
 */
describe('Promotions CRUD (feature 045)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  it('creates an action-based promotion with an inline rule', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: {
        name: '10% over 500',
        priority: 5,
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [500] },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; action: unknown; rule: unknown; kind: null; priority: number } };
    expect(body.data.kind).toBeNull();
    expect(body.data.priority).toBe(5);
    expect(body.data.action).toEqual({ type: 'percentage_off_cart', percent: 10 });
    expect(body.data.rule).toMatchObject({ kind: 'condition' });

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${body.data.id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
  });

  it('rejects a promotion with neither action nor legacy kind', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: { name: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects providing both ruleId and rule (rule_source_conflict)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: {
        name: 'conflict',
        action: { type: 'free_delivery' },
        ruleId: '00000000-0000-4000-8000-0000000000ff',
        rule: { kind: 'all' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists the 10 built-in action types', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/promotions/action-types',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ type: string }> } };
    expect(body.data.items).toHaveLength(10);
    expect(body.data.items.map((i) => i.type)).toContain('percentage_off_cart');
  });

  it('previews application against a cart snapshot', async () => {
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: {
        name: 'free ship',
        action: { type: 'free_delivery' },
        rule: { kind: 'all' },
      },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: adminCookie,
      payload: {
        organizationId: null,
        customerGroupId: null,
        currency: 'PLN',
        deliveryTotal: 25,
        lines: [
          { productId: '00000000-0000-4000-8000-000000000001', variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 100, currency: 'PLN' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { deliveryTotal: number; discountTotal: number } };
    expect(body.data.deliveryTotal).toBe(0);
    expect(body.data.discountTotal).toBe(25);
  });
});
