import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { seedCrmAdmin, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ReturnCase, ReturnCaseAttachment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, processReturnsNotification, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase, track } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T055 (US4; FR-072, FR-073; contracts/admin-api.md A5):
 * an operator holding `returns:erase_personal_data` erases a guest's personal data at
 * once, in any status, after an explicit confirmation. Nothing is e-mailed to the guest
 * about the case afterwards. The call is idempotent, refuses a customer's case, and a
 * restricted admin cannot tell the case exists.
 */
describe('returns — erasing a guest’s personal data on request (A5)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let reasonId: string;
  let undo: () => Promise<void>;
  let handler: { cookies: { b2b_session: string }; undo: () => void };
  let rep: { cookies: { b2b_session: string }; undo: () => void };
  const jobs: CapturedReturnsJob[] = [];

  const erase = (caseId: string, cookies: Record<string, string> = ADMIN_COOKIE, payload: unknown = { confirm: true }) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${caseId}/guest/erase`, cookies, payload: payload as object });
  const errorOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  const auditOf = (id: string) => h.em().fork().find(AuditLogEntry, { objectId: id, action: 'return_case.guest_data.erase' });
  const mailsOf = (caseId: string) => mailer.sent.filter((m) => m.meta?.['returnCaseId'] === caseId);

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
    // A case handler without the erasure permission, and a representative with it.
    handler = await seedCrmAdmin(h.em(), 'guest_erase_handler', ['returns:read', 'returns:write']);
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['returns:read', 'returns:write', 'returns:erase_personal_data']);
  });
  afterAll(async () => {
    handler.undo();
    rep.undo();
    await undo();
    await teardownBackendServer(h);
  });

  it('erases an open case at once, and no e-mail goes to the guest afterwards', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await erase(filed.caseId);
    expect(res.statusCode, res.body).toBe(200);
    const stamp = (res.json() as { data: { personalDataErasedAt: string } }).data.personalDataErasedAt;

    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id: filed.caseId }, { filters: false });
    expect(rc.statusCode).toBe('new');
    expect(rc.contact ?? null).toBeNull();
    expect(rc.returnAddress ?? null).toBeNull();
    expect(rc.personalDataErasedAt!.toISOString()).toBe(stamp);
    expect(await h.em().fork().count(ReturnCaseAttachment, { returnCaseId: filed.caseId }, { filters: false })).toBe(0);
    expect((await track(h, filed.trackingToken)).statusCode).toBe(404);

    const entries = await auditOf(filed.caseId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorAdminUserId).toBe(TEST_ADMIN_ID);
    expect(entries[0]!.stateAfter).toEqual({ trigger: 'request', attachmentCount: 1, fields: ['contact', 'returnAddress'] });
    expect(JSON.stringify(entries)).not.toContain(filed.email);

    // A notified comment and an authorization after the erasure reach nobody.
    const comment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${filed.caseId}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'We have your parcel', isCustomerVisible: true, notifyCustomer: true },
    });
    expect(comment.statusCode, comment.body).toBe(201);
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${filed.caseId}/authorize`, cookies: ADMIN_COOKIE })).statusCode).toBe(200);
    const commentId = (comment.json() as { data: { id: string } }).data.id;
    for (const job of jobs.filter((j) => (j.kind === 'comment_notify' && j.returnCaseCommentId === commentId) || ('returnCaseId' in j && j.returnCaseId === filed.caseId && j.kind === 'status_entered'))) {
      await processReturnsNotification(h, job);
    }
    expect(mailsOf(filed.caseId).filter((m) => m.to === filed.email)).toEqual([]);
    expect(mailer.sent.filter((m) => m.to === filed.email && m.meta?.['kind'] !== 'return_guest_verification' && m.meta?.['kind'] !== 'return_guest_submitted')).toEqual([]);
  });

  it('is idempotent: a second call answers the same stamp and records nothing', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const first = await erase(filed.caseId);
    const second = await erase(filed.caseId);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await auditOf(filed.caseId)).toHaveLength(1);
  });

  it('erases a closed case too', async () => {
    const filed = await fileGuestCase(h, reasonId);
    await h.em().getConnection().execute(`update "return_cases" set "status_code" = 'closed', "closed_at" = now() where "id" = ?`, [filed.caseId]);
    expect((await erase(filed.caseId)).statusCode).toBe(200);
  });

  it('refuses a customer’s case with 422 not_guest_case', async () => {
    const res = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default' } });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const refused = await erase(id);
    expect(refused.statusCode).toBe(422);
    expect(errorOf(refused)).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, details: { code: 'not_guest_case' } });
    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
    expect(rc.contact?.email).toBe('ewa@example.test');
  });

  it('requires an explicit confirmation', async () => {
    const filed = await fileGuestCase(h, reasonId);
    for (const payload of [{}, { confirm: false }, { confirm: 'yes' }, { confirm: true, extra: 1 }]) {
      expect((await erase(filed.caseId, ADMIN_COOKIE, payload)).statusCode).toBe(400);
    }
    expect(await auditOf(filed.caseId)).toEqual([]);
  });

  it('needs returns:erase_personal_data, and a restricted admin gets 404', async () => {
    const filed = await fileGuestCase(h, reasonId);
    expect((await erase(filed.caseId, handler.cookies)).statusCode).toBe(403);
    expect((await erase(filed.caseId, {})).statusCode).toBe(401);
    const hidden = await erase(filed.caseId, rep.cookies);
    expect(hidden.statusCode).toBe(404);
    expect(errorOf(hidden).code).toBe(ERROR_CODES.NOT_FOUND);
    expect(await auditOf(filed.caseId)).toEqual([]);
    const rc = await h.em().fork().findOneOrFail(ReturnCase, { id: filed.caseId }, { filters: false });
    expect(rc.personalDataErasedAt ?? null).toBeNull();
  });
});
