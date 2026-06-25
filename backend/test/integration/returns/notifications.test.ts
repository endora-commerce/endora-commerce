import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US2, FR-017) — customer is notified on authorize / reject.
 */
describe('returns — notifications', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
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

  it('sends an authorization email with the RMA number', async () => {
    const id = await createCase();
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
    const rma = (res.json() as { data: { rmaNumber: string } }).data.rmaNumber;

    const mail = mailer.sent.find((m) => m.meta?.['kind'] === 'return_authorized' && m.meta?.['returnCaseId'] === id);
    expect(mail).toBeTruthy();
    expect(mail!.to).toBe('stub-customer@example.com');
    expect(mail!.text).toContain(rma);
  });

  it('sends a rejection email with the reason', async () => {
    const id = await createCase();
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'Outside policy' },
    });

    const mail = mailer.sent.find((m) => m.meta?.['kind'] === 'return_rejected' && m.meta?.['returnCaseId'] === id);
    expect(mail).toBeTruthy();
    expect(mail!.text).toContain('Outside policy');
  });
});
