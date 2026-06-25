import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US2) — admin authorizes (RMA number) or rejects (reason).
 */
describe('returns — authorize / reject (US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createCase(): Promise<string> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('assigns a unique RMA number on authorization and advances the status', async () => {
    const a = await createCase();
    const b = await createCase();

    const ra = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${a}/authorize`, cookies: ADMIN_COOKIE });
    const rb = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${b}/authorize`, cookies: ADMIN_COOKIE });
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    const da = (ra.json() as { data: { rmaNumber: string; statusCode: string } }).data;
    const db = (rb.json() as { data: { rmaNumber: string; statusCode: string } }).data;
    expect(da.statusCode).toBe('authorized');
    expect(da.rmaNumber).toBeTruthy();
    expect(db.rmaNumber).toBeTruthy();
    expect(da.rmaNumber).not.toBe(db.rmaNumber);
  });

  it('rejects a case with a mandatory reason and reaches the rejected terminal', async () => {
    const id = await createCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'Outside warranty window' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { statusCode: string; rejectionReason: string } }).data;
    expect(data.statusCode).toBe('rejected');
    expect(data.rejectionReason).toBe('Outside warranty window');
  });

  it('refuses rejection without a reason', async () => {
    const id = await createCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: '' },
    });
    expect([400, 422]).toContain(res.statusCode);
  });
});
