import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import { complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { captureReturnsNotificationJobs, processReturnsNotification, type CapturedReturnsJob } from './notification-jobs.js';
import { allowGuests, fileGuestCase, track, trackingTokenOf } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T038 (US3; FR-046; contracts/admin-api.md A3; research
 * R-5): *Send a new tracking link*. The version goes up, the old link stops working,
 * and the guest receives the new one.
 */
describe('returns — sending a guest a new tracking link (A3)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let reasonId: string;
  let undo: () => Promise<void>;
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  const jobs: CapturedReturnsJob[] = [];

  const reissue = (caseId: string, cookies: Record<string, string> = ADMIN_COOKIE) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${caseId}/guest/tracking-link`, cookies, payload: {} });
  const errorOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
    reader = await seedCrmAdmin(h.em(), 'guest_link_reader', ['returns:read']);
  });
  afterAll(async () => {
    reader.undo();
    await undo();
    await teardownBackendServer(h);
  });

  it('increments the version, voids the old link and sends the new one', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await reissue(filed.caseId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { trackingVersion: 2 } });

    expect((await track(h, filed.trackingToken)).statusCode).toBe(404);
    expect((await track(h, trackingTokenOf(h, filed.caseId, 2))).statusCode).toBe(200);

    const job = jobs.find((j) => j.kind === 'guest_link_reissued' && j.caseId === filed.caseId);
    expect(job).toEqual({ kind: 'guest_link_reissued', caseId: filed.caseId, trackingVersion: 2 });
    await processReturnsNotification(h, job!);
    const mails = mailer.sent.filter((m) => m.meta?.['kind'] === 'return_guest_link_reissued' && m.meta?.['returnCaseId'] === filed.caseId);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(filed.email);
    expect(mails[0]!.text).toContain(`http://localhost:3000/returns/track/${trackingTokenOf(h, filed.caseId, 2)}`);

    const entries = await h.em().fork().find(AuditLogEntry, {
      objectType: 'return_case',
      objectId: filed.caseId,
      action: 'return_case.tracking_link.reissue',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.stateBefore).toEqual({ trackingVersion: 1 });
    expect(entries[0]!.stateAfter).toEqual({ trackingVersion: 2 });
  });

  it('sends nothing for a job whose version has been replaced since', async () => {
    const filed = await fileGuestCase(h, reasonId);
    await reissue(filed.caseId);
    await reissue(filed.caseId);
    const stale = jobs.find((j) => j.kind === 'guest_link_reissued' && j.caseId === filed.caseId && j.trackingVersion === 2)!;
    await processReturnsNotification(h, stale);
    expect(mailer.sent.filter((m) => m.meta?.['kind'] === 'return_guest_link_reissued' && m.meta?.['returnCaseId'] === filed.caseId)).toEqual([]);
  });

  it('refuses a customer’s case (422 not_guest_case) and an erased guest case (409)', async () => {
    const customer = await file(h, noOrderBody(reasonId), { headers: { 'x-sales-channel': 'default' } });
    expect(customer.statusCode, customer.body).toBe(201);
    const refused = await reissue((customer.json() as { data: { id: string } }).data.id);
    expect(refused.statusCode).toBe(422);
    expect(errorOf(refused)).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED, details: { code: 'not_guest_case' } });

    const filed = await fileGuestCase(h, reasonId);
    await h
      .em()
      .getConnection()
      .execute(`update "return_cases" set "personal_data_erased_at" = now(), "contact" = null where "id" = ?`, [filed.caseId]);
    const erased = await reissue(filed.caseId);
    expect(erased.statusCode).toBe(409);
    expect(errorOf(erased).code).toBe(ERROR_CODES.RETURN_GUEST_DATA_ERASED);
  });

  it('needs returns:write', async () => {
    const filed = await fileGuestCase(h, reasonId);
    expect((await reissue(filed.caseId, reader.cookies)).statusCode).toBe(403);
    expect((await reissue(filed.caseId, {})).statusCode).toBe(401);
  });
});
