import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T068 — Quote Request change history.
 *
 * Verifies that every state transition writes one row to
 * quote_request_events, that the chronology is preserved on read,
 * and that field-level diffs land in modify-event payloads.
 */
describe('Quote Requests — change history (US6)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function getEvents(rfqId: string): Promise<Array<{ eventType: string; payload: Record<string, unknown> }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    return (
      res.json() as { data: { events: Array<{ eventType: string; payload: Record<string, unknown> }> } }
    ).data.events;
  }

  it('logs created + submitted on customer create', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 7.5 }],
      },
    });
    const id = (created.json() as { data: { id: string } }).data.id;
    const events = await getEvents(id);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'submitted']);
  });

  it('logs the full Pending → modified → Approved chain through the negotiation loop', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 10, desiredUnitPrice: 8 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 10, agreedUnitPrice: 7.8 }] },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cur = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${r.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: cur.currentRevisionNumber },
    });
    const events = await getEvents(r.id);
    const types = events.map((e) => e.eventType);
    expect(types).toEqual([
      'created',
      'submitted',
      'modified',
      'customer-accepted-revision',
      'approved',
    ]);
  });

  it('logs canceled with the reason in the payload', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${r.id}/cancel`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { reason: 'Out of stock' },
    });
    const events = await getEvents(r.id);
    const cancel = events.find((e) => e.eventType === 'canceled');
    expect(cancel).toBeDefined();
    expect(cancel?.payload).toMatchObject({ reason: 'Out of stock' });
  });

  it('writes a non-empty diff array on modify events', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    const r = (created.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${r.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${r.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 7, agreedUnitPrice: 9.99 }] },
    });
    const events = await getEvents(r.id);
    const modify = events.find((e) => e.eventType === 'modified');
    expect(modify).toBeDefined();
    const diff = (modify?.payload as { diff: Array<{ kind: string }> }).diff;
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.map((d) => d.kind)).toContain('line_quantity');
  });
});
