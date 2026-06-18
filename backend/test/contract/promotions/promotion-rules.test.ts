import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (US6) — standalone named rules: CRUD, reuse by a promotion, and
 * delete-in-use guard.
 */
describe('Promotion named rules (feature 045)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const RULE = { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [1000] };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });
  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
    await h.em().getConnection().execute('truncate table promotion_rules cascade');
  });

  it('creates, reuses, and blocks deletion of an in-use rule', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotion-rules',
      cookies: adminCookie,
      payload: { name: 'VIP >= 1000', definition: RULE },
    });
    expect(create.statusCode).toBe(201);
    const ruleId = (create.json() as { data: { id: string } }).data.id;

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/promotion-rules', cookies: adminCookie });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);

    // A promotion referencing the named rule.
    const promo = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: { name: 'uses rule', action: { type: 'free_delivery' }, ruleId },
    });
    expect(promo.statusCode).toBe(201);

    // usedBy surfaces the dependency.
    const get = await h.app.inject({ method: 'GET', url: `/api/v1/admin/promotion-rules/${ruleId}`, cookies: adminCookie });
    expect((get.json() as { usedBy: unknown[] }).usedBy).toHaveLength(1);

    // Deletion is blocked while in use.
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/promotion-rules/${ruleId}`, cookies: adminCookie });
    expect(del.statusCode).toBe(409);
  });

  it('rejects a duplicate rule name', async () => {
    const mk = () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/promotion-rules',
        cookies: adminCookie,
        payload: { name: 'dup', definition: { kind: 'all' } },
      });
    expect((await mk()).statusCode).toBe(201);
    expect((await mk()).statusCode).toBe(409);
  });
});
