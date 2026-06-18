import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (US4) — bulk coupon generator endpoint.
 */
describe('Coupon generator (feature 045)', () => {
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

  async function createPromotion(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: { name: 'gen', action: { type: 'free_delivery' }, rule: { kind: 'all' } },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('generates N unique formatted codes and exports them as CSV', async () => {
    const id = await createPromotion();
    const gen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupon-batches`,
      cookies: adminCookie,
      payload: { count: 100, length: 8, format: 'alnum', prefix: 'SUMMER', dashEvery: 4, limitScope: 'shared_batch' },
    });
    expect(gen.statusCode).toBe(201);
    const genBody = gen.json() as { data: { batch: { id: string }; generated: number } };
    expect(genBody.data.generated).toBe(100);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
    });
    const coupons = (list.json() as { data: Array<{ code: string }> }).data;
    expect(coupons).toHaveLength(100);
    const codes = new Set(coupons.map((c) => c.code));
    expect(codes.size).toBe(100); // all unique
    for (const c of coupons) expect(c.code).toMatch(/^SUMMER[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const csv = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupon-batches/${genBody.data.batch.id}/export`,
      cookies: adminCookie,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n').filter((l) => l && l !== 'code')).toHaveLength(100);
  });
});
