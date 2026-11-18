import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Refund, ReturnCase, ReturnShipment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { complaintReasonId } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T047 (US3; FR-064; research R-11): a guest's case settles
 * through 180's off-platform branch unchanged — repair, replacement (with `returns`' own
 * replacement shipment row) and *settled outside the platform* — and never moves money:
 * a refund, a credit and a corrective invoice are refused as for any case bought elsewhere.
 */
describe('returns — settling a guest’s case', () => {
  let h: BackendServerHandle;
  let undo: () => Promise<void>;
  let reasonId: string;
  const jobs: CapturedReturnsJob[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    undo = await allowGuests(h);
    reasonId = await complaintReasonId(h.em());
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const admin = (method: 'GET' | 'POST', url: string, payload?: object) =>
    h.app.inject({ method, url, cookies: ADMIN_COOKIE, ...(payload ? { payload } : {}) });
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;

  async function guestCase(to: 'authorized' | 'received'): Promise<string> {
    const { caseId } = await fileGuestCase(h, reasonId);
    expect((await admin('POST', `/api/v1/admin/returns/${caseId}/authorize`)).statusCode).toBe(200);
    if (to === 'received') expect((await admin('POST', `/api/v1/admin/returns/${caseId}/transition`, { to: 'received' })).statusCode).toBe(200);
    return caseId;
  }
  const settle = (id: string, body: Record<string, unknown>) => admin('POST', `/api/v1/admin/returns/${id}/settlement`, { lines: [], ...body });
  const stored = (id: string) => h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });

  it('offers only the off-platform resolutions', async () => {
    const id = await guestCase('received');
    const res = await admin('GET', `/api/v1/admin/returns/${id}/settlement`);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown }).data).toMatchObject({
      resolutionOptions: ['replacement', 'repair', 'settled_outside'],
      defaultResolution: 'repair',
    });
  });

  it('settles a repair', async () => {
    const id = await guestCase('received');
    const res = await settle(id, { resolutionType: 'repair' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(id)).toMatchObject({ resolutionType: 'repair', customerAccountId: undefined, organizationId: undefined });
    expect(await h.em().fork().count(Refund, { returnCaseId: id })).toBe(0);
  });

  it('settles a replacement and records the replacement shipment on the case', async () => {
    const id = await guestCase('received');
    const shipment = await admin('POST', `/api/v1/admin/returns/${id}/shipments`, { direction: 'replacement', externalReference: 'PARCEL-181' });
    expect(shipment.statusCode, shipment.body).toBe(201);
    const res = await settle(id, { resolutionType: 'replacement' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await stored(id)).resolutionType).toBe('replacement');
    const rows = await h.em().fork().find(ReturnShipment, { returnCaseId: id });
    expect(rows.map((r) => ({ direction: r.direction, externalReference: r.externalReference }))).toEqual([
      { direction: 'replacement', externalReference: 'PARCEL-181' },
    ]);
    const listed = await admin('GET', `/api/v1/admin/returns/${id}/shipments`);
    expect((listed.json() as { data: Array<{ direction: string }> }).data.map((s) => s.direction)).toEqual(['replacement']);
  });

  it('settles outside the platform from authorized', async () => {
    const id = await guestCase('authorized');
    const res = await settle(id, { resolutionType: 'settled_outside', resolutionNote: 'Exchanged in the shop' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await stored(id)).toMatchObject({ statusCode: 'resolved', resolutionType: 'settled_outside' });
  });

  it('refuses a refund, a credit and a corrective invoice', async () => {
    const id = await guestCase('received');
    for (const body of [
      { resolutionType: 'refund', refundPaymentMethodId: '00000000-0000-4000-8000-000000000001' },
      { resolutionType: 'credit' },
      { resolutionType: 'repair', createCorrectiveInvoice: true },
    ]) {
      const res = await settle(id, body);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM);
    }
    expect((await stored(id)).resolutionType ?? null).toBeNull();
  });
});
