import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T014 / T017a (US1) — adapter-aware payment-method admin CRUD.
 *   - PUT accepts adapter / additionalPrice / statusOn*; GET returns full config.
 *   - unregistered adapter and unknown statusOn* are rejected (400).
 *   - GET /admin/order-statuses exposes the OrderStatusRegistry options.
 */
describe('Admin payment-methods (adapter-aware)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts with adapter/additionalPrice/statusOn* and reads them back', async () => {
    const code = `cfg_${Date.now()}`;
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/${code}`,
      ...admin,
      payload: {
        name: { default: 'Configured', pl: 'Skonfigurowana' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        additionalPrice: 4.5,
        statusOnPending: 'new',
        statusOnSuccess: 'confirmed',
        statusOnFailure: 'cancelled',
      },
    });
    expect(put.statusCode).toBe(200);
    const created = (put.json() as { data: Record<string, unknown> }).data;
    expect(created.adapter).toBe('bank_transfer');
    expect(created.additionalPrice).toBeCloseTo(4.5);
    expect(created.statusOnSuccess).toBe('confirmed');

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods',
      ...admin,
    });
    const rows = (list.json() as { data: Array<{ code: string; additionalPrice: number }> }).data;
    const mine = rows.find((r) => r.code === code);
    expect(mine?.additionalPrice).toBeCloseTo(4.5);
  });

  it('rejects an unregistered adapter (400)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/bad_${Date.now()}`,
      ...admin,
      payload: { name: { default: 'X' }, kind: 'gateway', adapter: 'does_not_exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown order-status reference (400)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/bad2_${Date.now()}`,
      ...admin,
      payload: { name: { default: 'X' }, kind: 'bank_transfer', statusOnSuccess: 'totally_bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('exposes order-status options for the admin selectors', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/order-statuses',
      ...admin,
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ code: string }> }).data.map((o) => o.code);
    expect(codes).toContain('new');
    expect(codes).toContain('confirmed');
  });
});
