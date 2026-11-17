import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrderReturnContextPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T054 (research R-10): every path that read the
 * case's order has an answer for a case without one.
 */
describe('returns — a case without a platform order on the order paths (R-10)', () => {
  let h: BackendServerHandle;
  let id: string;
  let undo: () => Promise<void>;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    undo = await allowOffPlatform(h);
    const res = await file(h, noOrderBody(await complaintReasonId(h.em())), { headers: { 'x-sales-channel': 'default' } });
    expect(res.statusCode, res.body).toBe(201);
    id = (res.json() as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const port = () => h.container.resolve<OrderReturnContextPort>('orderReturnContextPort');

  it('reads no order context for the detail', async () => {
    const spy = vi.spyOn(port(), 'getReturnContext');
    try {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { offPlatform: boolean } }).data.offPlatform).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('takes the no-order branch of the settlement prefill, reading no order', async () => {
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
    const spy = vi.spyOn(port(), 'getReturnContext');
    try {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/settlement`, cookies: ADMIN_COOKIE });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { resolutionOptions: string[] } }).data.resolutionOptions).not.toContain('refund');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('emits a transition with orderId null', async () => {
    const seen: Array<{ orderId: unknown }> = [];
    const off = h.eventBus.on('return.status.to_received.after', (e: unknown) => void seen.push(e as { orderId: unknown }));
    try {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${id}/transition`,
        cookies: ADMIN_COOKIE,
        payload: { to: 'received' },
      });
      expect(res.statusCode, res.body).toBe(200);
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]!.orderId).toBeNull();
    } finally {
      if (typeof off === 'function') off();
    }
  });

  it('leaves orderId empty in the export, and an order-id search does not find it', async () => {
    const csv = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/export?origin=off_platform', cookies: ADMIN_COOKIE });
    const [header, ...rows] = csv.body.split('\r\n');
    const columns = header!.split(',');
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
    const reference = (detail.json() as { data: { reference: string } }).data.reference;
    const line = rows.find((r) => r.split(',')[columns.indexOf('reference')] === reference)!;
    expect(line.split(',')[columns.indexOf('orderId')]).toBe('');
    const search = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/returns?q=00000000-0000-4000-8000-000000000000',
      cookies: ADMIN_COOKIE,
    });
    expect((search.json() as { data: { rows: Array<{ id: string }> } }).data.rows.map((r) => r.id)).not.toContain(id);
  });
});
