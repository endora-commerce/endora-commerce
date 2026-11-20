import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ReturnCaseAttachment, ReturnCaseComment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, resetReturnGraph } from './helpers.js';
import { TINY_PNG, complaintReasonId } from './off-platform-fixtures.js';
import {
  GUEST_COOKIE,
  allowGuests,
  fileGuestCase,
  track,
  trackComment,
  trackFile,
  trackUpload,
  trackingTokenOf,
  type FiledGuestCase,
} from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T036 (US2; FR-040 – FR-043; research R-1, R-5, R-6):
 * the tracking link (G8 – G10).
 *
 * - The view carries customer-visible content only, in the request language.
 * - A token reaches exactly its own case; an expired, replaced, erased, garbage or
 *   missing token is one identical 404.
 * - A closed case is read-only; a guest comment is customer-visible, marked as a
 *   guest's and audited; a guest file is audited; comments are limited per case.
 * - The token travels in a header, never in the URL.
 * - A signed-in customer's session on the same request changes nothing (lead ruling 1).
 */
describe('returns — the guest’s tracking link', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let undo: () => Promise<void>;

  const errorOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  const sql = (statement: string, params: unknown[]) => h.em().getConnection().execute(statement, params);
  const withoutRequestId = (body: string): string => {
    const { error } = JSON.parse(body) as { error: Record<string, unknown> };
    const { requestId: _requestId, ...rest } = error;
    return JSON.stringify(rest);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reasonId = await complaintReasonId(h.em());
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  async function adminComment(caseId: string, body: string, isCustomerVisible: boolean): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${caseId}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body, isCustomerVisible, notifyCustomer: false },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  async function close(caseId: string, closedDaysAgo: number): Promise<void> {
    await sql(
      `update "return_cases" set "status_code" = 'closed', "closed_at" = now() - (? || ' days')::interval where "id" = ?`,
      [String(closedDaysAgo), caseId],
    );
  }

  describe('the view (G8)', () => {
    it('shows customer-visible content only, with the status in the request language', async () => {
      const filed = await fileGuestCase(h, reasonId, { over: { comment: 'Please hurry' } });
      await adminComment(filed.caseId, 'We are checking it', true);
      await adminComment(filed.caseId, 'Internal: supplier fault', false);
      await sql(`update "return_cases" set "resolution_note" = 'secret note' where "id" = ?`, [filed.caseId]);

      const res = await track(h, filed.trackingToken, { headers: { 'accept-language': 'pl' } });
      expect(res.statusCode, res.body).toBe(200);
      const view = (res.json() as { data: Record<string, unknown> & { comments: Array<{ authorKind: string; body: string }> } }).data;
      expect(view).toMatchObject({
        reference: filed.reference,
        kind: 'complaint',
        status: { code: 'new', label: 'Nowe' },
        isClosed: false,
        linkValidUntil: null,
        contact: { name: 'Gość Kowalski', email: filed.email, phone: '+48 600 000 181' },
        purchase: { proofNumber: 'FV/181/2026', date: '2026-10-01' },
        rmaNumber: null,
        rejectionReason: null,
      });
      expect(view.comments.map((c) => [c.authorKind, c.body])).toEqual([
        ['you', 'Please hurry'],
        ['shop', 'We are checking it'],
      ]);
      expect(res.body).not.toContain('Internal: supplier fault');
      expect(res.body).not.toContain('secret note');
      expect(view).not.toHaveProperty('resolutionNote');
      expect((view['attachments'] as unknown[]).length).toBe(1);
    });

    it('answers one identical 404 for an expired, replaced, erased, garbage or missing token (FR-043)', async () => {
      const expired = await fileGuestCase(h, reasonId);
      await close(expired.caseId, 91);
      const replaced = await fileGuestCase(h, reasonId);
      await sql(`update "return_cases" set "tracking_version" = 2 where "id" = ?`, [replaced.caseId]);
      const erased = await fileGuestCase(h, reasonId);
      await sql(`update "return_cases" set "personal_data_erased_at" = now(), "contact" = null, "return_address" = null where "id" = ?`, [
        erased.caseId,
      ]);
      const garbage = `${replaced.trackingToken.slice(0, -4)}AAAA`;

      const en = { headers: { 'accept-language': 'en' } };
      const answers = [
        await track(h, expired.trackingToken, en),
        await track(h, replaced.trackingToken, en),
        await track(h, erased.trackingToken, en),
        await track(h, garbage, en),
        await track(h, 'garbage', en),
        await track(h, null, en),
      ];
      for (const res of answers) {
        expect(res.statusCode, res.body).toBe(404);
        expect(errorOf(res).code).toBe(ERROR_CODES.RETURN_TRACKING_LINK_INVALID);
      }
      expect(new Set(answers.map((r) => withoutRequestId(r.body))).size).toBe(1);
      // The replacement opens the case.
      expect((await track(h, trackingTokenOf(h, replaced.caseId, 2))).statusCode).toBe(200);
      // A comment or a file through a refused token is the same 404.
      expect((await trackComment(h, expired.trackingToken, 'hello', en)).statusCode).toBe(404);
      expect((await trackUpload(h, replaced.trackingToken)).statusCode).toBe(404);
    });

    it('keeps a closed case readable for 90 days, read-only, with the link’s end date', async () => {
      const filed = await fileGuestCase(h, reasonId);
      await close(filed.caseId, 10);
      const res = await track(h, filed.trackingToken);
      expect(res.statusCode, res.body).toBe(200);
      const view = (res.json() as { data: { isClosed: boolean; linkValidUntil: string | null } }).data;
      expect(view.isClosed).toBe(true);
      expect(new Date(view.linkValidUntil!).getTime()).toBeGreaterThan(Date.now() + 79 * 86_400_000);

      const comment = await trackComment(h, filed.trackingToken, 'One more thing');
      expect(comment.statusCode).toBe(409);
      expect(errorOf(comment)).toMatchObject({ code: ERROR_CODES.RETURN_COMMENTS_CLOSED });
      const upload = await trackUpload(h, filed.trackingToken);
      expect(upload.statusCode).toBe(409);
      expect(errorOf(upload).code).toBe(ERROR_CODES.RETURN_CASE_CLOSED);
    });

    it('shows the rejection reason of a rejected case (owner ruling O-1, FR-041)', async () => {
      const filed = await fileGuestCase(h, reasonId);
      await sql(
        `update "return_cases" set "status_code" = 'rejected', "rejection_reason" = 'No defect found', "closed_at" = now() where "id" = ?`,
        [filed.caseId],
      );
      const res = await track(h, filed.trackingToken);
      expect(res.statusCode, res.body).toBe(200);
      const view = (res.json() as { data: { isClosed: boolean; rejectionReason: string | null } }).data;
      expect(view).toMatchObject({ isClosed: true, rejectionReason: 'No defect found' });
    });

    it('does not take the token from the URL', async () => {
      const filed = await fileGuestCase(h, reasonId);
      const inQuery = await h.app.inject({ method: 'GET', url: `/api/v1/returns/track?token=${filed.trackingToken}` });
      expect(inQuery.statusCode).toBe(404);
      expect(errorOf(inQuery).code).toBe(ERROR_CODES.RETURN_TRACKING_LINK_INVALID);
      const inPath = await h.app.inject({ method: 'GET', url: `/api/v1/returns/track/${filed.trackingToken}` });
      expect(inPath.statusCode).toBe(404);
    });
  });

  describe('one token, one case', () => {
    let a: FiledGuestCase;
    let b: FiledGuestCase;
    let fileOfB: string;

    beforeAll(async () => {
      a = await fileGuestCase(h, reasonId);
      b = await fileGuestCase(h, reasonId);
      const rows = await h.em().fork().find(ReturnCaseAttachment, { returnCaseId: b.caseId }, { filters: false });
      fileOfB = rows[0]!.id;
    });

    it('reads, comments on and downloads from its own case only', async () => {
      const view = await track(h, a.trackingToken);
      expect((view.json() as { data: { reference: string } }).data.reference).toBe(a.reference);
      expect((await trackFile(h, a.trackingToken, fileOfB)).statusCode).toBe(404);
      expect((await trackComment(h, a.trackingToken, 'Mine')).statusCode).toBe(201);
      const onB = await h.em().fork().find(ReturnCaseComment, { returnCaseId: b.caseId });
      expect(onB.map((c) => c.body)).not.toContain('Mine');
    });

    it('downloads its own file with 180’s headers', async () => {
      const res = await trackFile(h, b.trackingToken, fileOfB);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('writing through the link (G9, G10)', () => {
    it('stores a guest comment visible to the customer, audited by name and length only', async () => {
      const filed = await fileGuestCase(h, reasonId);
      const res = await trackComment(h, filed.trackingToken, 'The battery is worse now');
      expect(res.statusCode, res.body).toBe(201);
      const comments = await h.em().fork().find(ReturnCaseComment, { returnCaseId: filed.caseId, authorGuest: true });
      expect(comments).toHaveLength(1);
      expect(comments[0]!).toMatchObject({ isCustomerVisible: true, notifyCustomer: false, body: 'The battery is worse now' });
      expect(comments[0]!.authorCustomerAccountId ?? null).toBeNull();
      expect(comments[0]!.authorAdminUserId ?? null).toBeNull();

      const entries = await h.em().fork().find(AuditLogEntry, {
        objectType: 'return_case',
        objectId: filed.caseId,
        action: 'return_case.comment.add_by_guest',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.stateAfter).toEqual({ commentId: comments[0]!.id, length: 'The battery is worse now'.length, by: 'guest' });

      const view = (await track(h, filed.trackingToken)).json() as { data: { comments: Array<{ authorKind: string }> } };
      expect(view.data.comments.at(-1)!.authorKind).toBe('you');
      const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${filed.caseId}`, cookies: ADMIN_COOKIE });
      const adminComments = (admin.json() as { data: { comments: Array<{ authorKind: string }> } }).data.comments;
      expect(adminComments.at(-1)!.authorKind).toBe('guest');
    });

    it('stores a guest file, audited as a guest’s', async () => {
      const filed = await fileGuestCase(h, reasonId);
      const res = await trackUpload(h, filed.trackingToken, {
        type: 'photo',
        filename: 'photo.png',
        mime: 'image/png',
        value: TINY_PNG,
      });
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      const row = await h.em().fork().findOneOrFail(ReturnCaseAttachment, { id }, { filters: false });
      expect(row).toMatchObject({ returnCaseId: filed.caseId, uploadedByGuest: true, storageLocator: `returns/guest/${id}` });
      expect(row.organizationId ?? null).toBeNull();
      const entries = await h.em().fork().find(AuditLogEntry, {
        objectType: 'return_case',
        objectId: filed.caseId,
        action: 'return_case.attachment.add',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.stateAfter).toMatchObject({ attachmentId: id, type: 'photo', by: 'guest' });
    });

    it('allows 20 comments per case in 24 hours', async () => {
      const filed = await fileGuestCase(h, reasonId);
      for (let i = 0; i < 20; i += 1) expect((await trackComment(h, filed.trackingToken, `Note ${i}`)).statusCode).toBe(201);
      const over = await trackComment(h, filed.trackingToken, 'One too many');
      expect(over.statusCode).toBe(429);
      expect(errorOf(over)).toMatchObject({ code: ERROR_CODES.RETURN_GUEST_LIMIT_REACHED, details: { limit: 'comments_per_case' } });
    });
  });

  it('reads and comments with a customer session on the same request (ruling 1)', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const cookies = { ...CUSTOMER_COOKIE, [GUEST_COOKIE]: filed.sessionToken };
    const view = await track(h, filed.trackingToken, { cookies });
    expect(view.statusCode, view.body).toBe(200);
    expect((view.json() as { data: { reference: string } }).data.reference).toBe(filed.reference);
    const comment = await trackComment(h, filed.trackingToken, 'Signed in elsewhere', { cookies });
    expect(comment.statusCode, comment.body).toBe(201);
  });
});
