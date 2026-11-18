import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { complaintReasonId } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, processReturnsNotification, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase, trackingTokenOf } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T037 (US2; FR-044, FR-072; research R-5, R-7): every
 * e-mail about a guest's case is the guest twin, sent to the verified address with the
 * **current** tracking link — and nothing is sent once the guest's data is erased.
 */
describe('returns — the e-mails of a guest’s case', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let reasonId: string;
  let undo: () => Promise<void>;
  const jobs: CapturedReturnsJob[] = [];

  const mailsFor = (kind: string, id: string) =>
    mailer.sent.filter((m) => m.meta?.['kind'] === kind && m.meta?.['returnCaseId'] === id);
  const linkOf = (caseId: string, version: number) => `http://localhost:3000/returns/track/${trackingTokenOf(h, caseId, version)}`;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  const admin = (method: 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, cookies: ADMIN_COOKIE, ...(payload ? { payload } : {}) });

  async function notifiedComment(caseId: string, body: string): Promise<void> {
    const res = await admin('POST', `/api/v1/admin/returns/${caseId}/comments`, { body, isCustomerVisible: true, notifyCustomer: true });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const job = jobs.find((j) => j.kind === 'comment_notify' && j.returnCaseCommentId === id);
    expect(job).toBeTruthy();
    await processReturnsNotification(h, job!);
  }

  it('sends a notified comment as the guest twin with the tracking link', async () => {
    const filed = await fileGuestCase(h, reasonId);
    await notifiedComment(filed.caseId, 'We need a photo of the label');
    const mails = mailsFor('return_guest_comment_added', filed.caseId);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(filed.email);
    expect(mails[0]!.text).toContain('We need a photo of the label');
    expect(mails[0]!.text).toContain(linkOf(filed.caseId, 1));
    expect(mailsFor('return_comment_added', filed.caseId)).toHaveLength(0);
  });

  it('sends the authorization, the status entry and the rejection as guest twins', async () => {
    const res = await admin('PATCH', '/api/v1/admin/returns/statuses/received', { notifyCustomerOnEntry: true });
    expect(res.statusCode).toBe(200);
    try {
      const filed = await fileGuestCase(h, reasonId);
      const authorized = await admin('POST', `/api/v1/admin/returns/${filed.caseId}/authorize`);
      expect(authorized.statusCode, authorized.body).toBe(200);
      const rma = (authorized.json() as { data: { rmaNumber: string } }).data.rmaNumber;
      const auth = mailsFor('return_guest_authorized', filed.caseId);
      expect(auth).toHaveLength(1);
      expect(auth[0]!.to).toBe(filed.email);
      expect(auth[0]!.text).toContain(rma);
      expect(auth[0]!.text).toContain(linkOf(filed.caseId, 1));
      expect(mailsFor('return_authorized', filed.caseId)).toHaveLength(0);

      const moved = await admin('POST', `/api/v1/admin/returns/${filed.caseId}/transition`, { to: 'received' });
      expect(moved.statusCode, moved.body).toBe(200);
      const job = jobs.find((j) => j.kind === 'status_entered' && j.returnCaseId === filed.caseId);
      expect(job).toBeTruthy();
      await processReturnsNotification(h, job!);
      const status = mailsFor('return_guest_status_entered', filed.caseId);
      expect(status).toHaveLength(1);
      expect(status[0]!.to).toBe(filed.email);
      expect(status[0]!.text).toContain(linkOf(filed.caseId, 1));

      const rejected = await admin('POST', `/api/v1/admin/returns/${filed.caseId}/reject`, { reason: 'Damaged by use' });
      expect(rejected.statusCode, rejected.body).toBe(200);
      const reject = mailsFor('return_guest_rejected', filed.caseId);
      expect(reject).toHaveLength(1);
      expect(reject[0]!.text).toContain('Damaged by use');
      expect(reject[0]!.text).toContain(linkOf(filed.caseId, 1));
    } finally {
      await admin('PATCH', '/api/v1/admin/returns/statuses/received', { notifyCustomerOnEntry: false });
    }
  });

  it('carries the new link in the next e-mail after a reissue', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const reissued = await admin('POST', `/api/v1/admin/returns/${filed.caseId}/guest/tracking-link`, {});
    expect(reissued.statusCode, reissued.body).toBe(200);
    await notifiedComment(filed.caseId, 'After the new link');
    const mails = mailsFor('return_guest_comment_added', filed.caseId);
    expect(mails.at(-1)!.text).toContain(linkOf(filed.caseId, 2));
    expect(mails.at(-1)!.text).not.toContain(linkOf(filed.caseId, 1));
  });

  it('sends nothing once the guest’s data is erased (FR-072)', async () => {
    const filed = await fileGuestCase(h, reasonId);
    await h
      .em()
      .getConnection()
      .execute(`update "return_cases" set "personal_data_erased_at" = now(), "contact" = null, "return_address" = null where "id" = ?`, [
        filed.caseId,
      ]);
    await notifiedComment(filed.caseId, 'Nobody reads this');
    const rejected = await admin('POST', `/api/v1/admin/returns/${filed.caseId}/reject`, { reason: 'Too late' });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(mailer.sent.filter((m) => m.meta?.['returnCaseId'] === filed.caseId && m.meta?.['kind'] !== 'return_new_case')).toEqual([]);
    expect(mailer.sent.filter((m) => m.to === filed.email)).toEqual([]);
  });
});
