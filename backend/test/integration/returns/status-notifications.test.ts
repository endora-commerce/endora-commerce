import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import {
  captureReturnsNotificationJobs,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` US3 — *notify the customer on entry*
 * (FR-A30 – FR-A33, D-2, D-13).
 *
 * T013: the status write persists the flag inside its audited transaction, and
 * refuses it on `authorized` and `rejected`, which send their dedicated e-mail.
 */
describe('returns — status notifications', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const jobs: CapturedReturnsJob[] = [];

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  type Graph = { statuses: Array<{ code: string; notifyCustomerOnEntry: boolean }> };

  async function patchStatus(code: string, payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/returns/statuses/${code}`,
      cookies: ADMIN_COOKIE,
      payload,
    });
  }

  describe('the status write (T013, FR-A30, FR-A52)', () => {
    it('persists the flag and answers it in the graph, false by default', async () => {
      const before = await h.app.inject({ method: 'GET', url: '/api/v1/admin/returns/statuses', cookies: ADMIN_COOKIE });
      const received = (before.json() as { data: Graph }).data.statuses.find((s) => s.code === 'received');
      expect(received?.notifyCustomerOnEntry).toBe(false);

      const res = await patchStatus('received', { notifyCustomerOnEntry: true });
      expect(res.statusCode).toBe(200);
      const after = (res.json() as { data: Graph }).data.statuses.find((s) => s.code === 'received');
      expect(after?.notifyCustomerOnEntry).toBe(true);

      const off = await patchStatus('received', { notifyCustomerOnEntry: false });
      expect((off.json() as { data: Graph }).data.statuses.find((s) => s.code === 'received')?.notifyCustomerOnEntry).toBe(
        false,
      );
    });

    it('may mark the initial status: filing is not an entry into it (D-2)', async () => {
      const res = await patchStatus('new', { notifyCustomerOnEntry: true });
      expect(res.statusCode).toBe(200);
      await patchStatus('new', { notifyCustomerOnEntry: false });
    });

    it.each(['authorized', 'rejected'])('refuses the flag on %s with dedicated_email_status', async (code) => {
      const res = await patchStatus(code, { notifyCustomerOnEntry: true });
      expect(res.statusCode).toBe(422);
      const error = (res.json() as { error: { code: string; details: { code: string } } }).error;
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details.code).toBe('dedicated_email_status');

      // Turning it off there is harmless and accepted.
      expect((await patchStatus(code, { notifyCustomerOnEntry: false })).statusCode).toBe(200);
    });

    it('accepts the flag on a status it creates', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/returns/statuses',
        cookies: ADMIN_COOKIE,
        payload: { code: 'awaiting_parts', name: { en: 'Awaiting parts' }, defaultName: 'Awaiting parts', notifyCustomerOnEntry: true },
      });
      expect(res.statusCode).toBe(201);
      expect(
        (res.json() as { data: Graph }).data.statuses.find((s) => s.code === 'awaiting_parts')?.notifyCustomerOnEntry,
      ).toBe(true);
      await h.app.inject({ method: 'DELETE', url: '/api/v1/admin/returns/statuses/awaiting_parts', cookies: ADMIN_COOKIE });
    });
  });

  /**
   * T024 (FR-A31 – FR-A33, D-2, D-13): a transition into a marked status by an
   * operator or the platform e-mails the filer once; the customer's own transition,
   * filing, and the two statuses with a dedicated e-mail never send it.
   */
  describe('the status e-mail (T024)', () => {
    async function fileCase(): Promise<string> {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const reasonId = await anyReasonId(h.em());
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/returns',
        cookies: CUSTOMER_COOKIE,
        payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    }
    const transition = (id: string, to: string) =>
      h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/transition`, cookies: ADMIN_COOKIE, payload: { to } });
    const statusJobs = (id: string) =>
      jobs.filter((j): j is Extract<CapturedReturnsJob, { kind: 'status_entered' }> => j.kind === 'status_entered' && j.returnCaseId === id);
    const statusMails = (id: string) =>
      mailer.sent.filter((m) => m.meta?.['kind'] === 'return_status_entered' && m.meta?.['returnCaseId'] === id);

    async function marking<T>(codes: string[], body: () => Promise<T>): Promise<T> {
      for (const code of codes) expect((await patchStatus(code, { notifyCustomerOnEntry: true })).statusCode).toBe(200);
      try {
        return await body();
      } finally {
        for (const code of codes) await patchStatus(code, { notifyCustomerOnEntry: false });
      }
    }

    it('an operator’s transition into a marked status sends one e-mail naming it', async () => {
      await marking(['received'], async () => {
        const id = await fileCase();
        expect((await transition(id, 'authorized')).statusCode).toBe(200);
        expect((await transition(id, 'received')).statusCode).toBe(200);
        const queued = statusJobs(id);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ statusCode: 'received' });

        await processReturnsNotification(h, queued[0]!);
        const mails = statusMails(id);
        expect(mails).toHaveLength(1);
        expect(mails[0]!.to).toBe('stub-customer@example.com');
        expect(mails[0]!.subject).toContain('Received');
      });
    });

    it('a shipment received by the platform into a marked status sends one too', async () => {
      await marking(['received'], async () => {
        const id = await fileCase();
        await transition(id, 'authorized');
        const shipment = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/returns/${id}/shipments`,
          cookies: ADMIN_COOKIE,
          payload: { direction: 'inbound', externalReference: 'TRACK-180' },
        });
        const shipmentId = (shipment.json() as { data: { id: string } }).data.id;
        const received = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/returns/${id}/shipments/${shipmentId}/receive`,
          cookies: ADMIN_COOKIE,
        });
        expect(received.statusCode, received.body).toBe(200);
        expect(statusJobs(id)).toHaveLength(1);
      });
    });

    it('the customer’s own cancellation sends none, though cancelled is marked (D-13)', async () => {
      await marking(['cancelled'], async () => {
        const id = await fileCase();
        const res = await h.app.inject({ method: 'POST', url: `/api/v1/returns/${id}/cancel`, cookies: CUSTOMER_COOKIE });
        expect(res.statusCode, res.body).toBe(200);
        expect(statusJobs(id)).toHaveLength(0);
      });
    });

    it('filing with the initial status marked sends only the confirmation (D-2)', async () => {
      await marking(['new'], async () => {
        const id = await fileCase();
        expect(statusJobs(id)).toHaveLength(0);
        expect(jobs.filter((j) => j.kind === 'case_submitted' && j.returnCaseId === id)).toHaveLength(1);
      });
    });

    it('entering authorized or rejected sends only the dedicated e-mail (FR-A32)', async () => {
      const authorized = await fileCase();
      await transition(authorized, 'authorized');
      const rejected = await fileCase();
      await transition(rejected, 'rejected');
      expect(statusJobs(authorized)).toHaveLength(0);
      expect(statusJobs(rejected)).toHaveLength(0);
      expect(mailer.sent.filter((m) => m.meta?.['kind'] === 'return_authorized' && m.meta?.['returnCaseId'] === authorized)).toHaveLength(1);
      expect(mailer.sent.filter((m) => m.meta?.['kind'] === 'return_rejected' && m.meta?.['returnCaseId'] === rejected)).toHaveLength(1);
    });

    it('marking a status sends nothing for the cases already in it (FR-A33)', async () => {
      const id = await fileCase();
      await transition(id, 'authorized');
      await transition(id, 'received');
      const before = jobs.length;
      await marking(['received'], async () => {
        expect(jobs.length).toBe(before);
        expect(statusJobs(id)).toHaveLength(0);
      });
    });
  });
});
