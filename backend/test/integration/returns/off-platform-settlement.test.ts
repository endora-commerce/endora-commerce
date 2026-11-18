import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type CorrectiveInvoicePort, type CreditTopupPort, type PaymentRefundPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Refund, ReturnCase } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T076 (FR-B33, FR-B33a, FR-B42, D-5, research R-19):
 * settling a case without a platform order — repair, replacement or settled outside the
 * platform, never money through it.
 */
describe('returns — settling a case without a platform order', () => {
  let h: BackendServerHandle;
  let undo: () => Promise<void>;
  let reasonId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    undo = await allowOffPlatform(h);
    reasonId = await complaintReasonId(h.em());
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const admin = (method: 'GET' | 'POST', url: string, payload?: object) =>
    h.app.inject({ method, url, cookies: ADMIN_COOKIE, ...(payload ? { payload } : {}) });
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;

  async function offPlatformCase(to: 'new' | 'authorized' | 'received' = 'authorized'): Promise<string> {
    const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default' } });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    if (to !== 'new') expect((await admin('POST', `/api/v1/admin/returns/${id}/authorize`)).statusCode).toBe(200);
    if (to === 'received') expect((await admin('POST', `/api/v1/admin/returns/${id}/transition`, { to: 'received' })).statusCode).toBe(200);
    return id;
  }
  const prefill = async (id: string) => {
    const res = await admin('GET', `/api/v1/admin/returns/${id}/settlement`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { resolutionOptions: string[]; defaultResolution: string } }).data;
  };
  const settle = (id: string, body: Record<string, unknown>) =>
    admin('POST', `/api/v1/admin/returns/${id}/settlement`, { lines: [], ...body });

  it('offers repair, replacement and settled_outside from received, repair first', async () => {
    const id = await offPlatformCase('received');
    expect(await prefill(id)).toMatchObject({ resolutionOptions: ['replacement', 'repair', 'settled_outside'], defaultResolution: 'repair' });
  });

  it('refuses a refund, a credit and a corrective invoice', async () => {
    const id = await offPlatformCase('received');
    for (const body of [{ resolutionType: 'refund', refundPaymentMethodId: '00000000-0000-4000-8000-000000000001' }, { resolutionType: 'credit' }, { resolutionType: 'repair', createCorrectiveInvoice: true }]) {
      const res = await settle(id, body);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res)).toMatchObject({ code: ERROR_CODES.RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM });
    }
  });

  it('serves only settled_outside on an authorized case, and settles it into resolved without a graph edge (D-5)', async () => {
    const id = await offPlatformCase('authorized');
    expect(await prefill(id)).toMatchObject({ resolutionOptions: ['settled_outside'], defaultResolution: 'settled_outside' });
    const seen: unknown[] = [];
    const off = h.eventBus.on('return.status.to_resolved.after', (e: unknown) => void seen.push(e));
    try {
      const res = await settle(id, { resolutionType: 'settled_outside', resolutionNote: 'Refunded in the store on 12 Nov — PRIVATE-NOTE' });
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      off();
    }
    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
    expect(rc).toMatchObject({ statusCode: 'resolved', resolutionType: 'settled_outside' });
    expect(rc.resolutionNote).toContain('PRIVATE-NOTE');
    expect(seen).toHaveLength(1);
    const entries = await h.em().fork().find(AuditLogEntry, { objectId: id, action: 'return.settled' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.stateAfter).toMatchObject({ resolutionType: 'settled_outside', hasNote: true });
    expect(JSON.stringify(entries)).not.toContain('PRIVATE-NOTE');
    expect(await h.em().fork().count(Refund, { returnCaseId: id })).toBe(0);
    const detail = await admin('GET', `/api/v1/admin/returns/${id}`);
    expect((detail.json() as { data: { resolutionNote: string } }).data.resolutionNote).toContain('PRIVATE-NOTE');
  });

  it('reaches no payment, invoice or credit port', async () => {
    const spies = [
      vi.spyOn(h.container.resolve<PaymentRefundPort>('paymentRefundPort'), 'refund'),
      vi.spyOn(h.container.resolve<CorrectiveInvoicePort>('correctiveInvoicePort'), 'createCorrection'),
      vi.spyOn(h.container.resolve<CreditTopupPort>('creditTopupPort'), 'creditFromReturn'),
    ];
    try {
      const id = await offPlatformCase('received');
      expect((await settle(id, { resolutionType: 'repair' })).statusCode).toBe(200);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('still refuses a plain transition from authorized to resolved, for both kinds of case', async () => {
    const off = await offPlatformCase('authorized');
    expect((await admin('POST', `/api/v1/admin/returns/${off}/transition`, { to: 'resolved' })).statusCode).toBe(409);
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const created = await file(h, { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] });
    const id = (created.json() as { data: { id: string } }).data.id;
    await admin('POST', `/api/v1/admin/returns/${id}/authorize`);
    expect((await admin('POST', `/api/v1/admin/returns/${id}/transition`, { to: 'resolved' })).statusCode).toBe(409);
  });

  it('refuses settled_outside on an unauthorized, a settled and a terminal case with 409', async () => {
    const fresh = await offPlatformCase('new');
    expect((await settle(fresh, { resolutionType: 'settled_outside', resolutionNote: 'x' })).statusCode).toBe(409);
    const settled = await offPlatformCase('authorized');
    expect((await settle(settled, { resolutionType: 'settled_outside', resolutionNote: 'x' })).statusCode).toBe(200);
    expect((await settle(settled, { resolutionType: 'settled_outside', resolutionNote: 'x' })).statusCode).toBe(409);
    const rejected = await offPlatformCase('new');
    await admin('POST', `/api/v1/admin/returns/${rejected}/reject`, { reason: 'x' });
    expect((await settle(rejected, { resolutionType: 'settled_outside', resolutionNote: 'x' })).statusCode).toBe(409);
  });

  it('requires the note', async () => {
    const id = await offPlatformCase('authorized');
    const res = await settle(id, { resolutionType: 'settled_outside' });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res).details?.['code']).toBe('resolution_note_required');
  });

  it('refuses settled_outside on an order case', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const created = await file(h, { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] });
    const id = (created.json() as { data: { id: string } }).data.id;
    await admin('POST', `/api/v1/admin/returns/${id}/authorize`);
    await admin('POST', `/api/v1/admin/returns/${id}/transition`, { to: 'received' });
    const res = await settle(id, { resolutionType: 'settled_outside', resolutionNote: 'x' });
    expect(res.statusCode).toBe(422);
    expect(errorOf(res)).toMatchObject({ code: ERROR_CODES.RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM, details: { resolution: 'settled_outside' } });
  });
});
