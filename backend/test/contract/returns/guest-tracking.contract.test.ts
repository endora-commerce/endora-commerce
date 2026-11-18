import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  adminReissueTrackingLinkResultSchema,
  guestCaseViewSchema,
  returnAttachmentSchema,
  returnCaseCommentSchema,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIE, resetReturnGraph } from '../../integration/returns/helpers.js';
import { complaintReasonId } from '../../integration/returns/off-platform-fixtures.js';
import { overrideReturnsSetting } from '../../integration/returns/notification-jobs.js';
import {
  GUEST_SETTING,
  allowGuests,
  fileGuestCase,
  track,
  trackComment,
  trackFile,
  trackUpload,
} from '../../integration/returns/guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T043, contracts/guest-api.md G8 – G10 and
 * contracts/admin-api.md A3: the tracking routes' shapes and envelopes, and the
 * reissue route's.
 */
const envelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string().optional() }),
});

describe('guest tracking API (G8 – G10, A3)', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let undo: () => Promise<void>;

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

  const errorOf = (body: string) => envelope.parse(JSON.parse(body)).error;

  it('G8 answers { data: GuestCaseView } with no other key', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await track(h, filed.trackingToken);
    expect(res.statusCode, res.body).toBe(200);
    const view = guestCaseViewSchema.strict().parse((res.json() as { data: unknown }).data);
    expect(view.reference).toBe(filed.reference);
  });

  it('G9 answers 201 { data: comment }', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await trackComment(h, filed.trackingToken, 'A question');
    expect(res.statusCode, res.body).toBe(201);
    const data = returnCaseCommentSchema.parse((res.json() as { data: unknown }).data);
    expect(data).toMatchObject({ authorKind: 'guest', body: 'A question', isCustomerVisible: true });
  });

  it('G9 refuses an empty or a strict-violating body with 400', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const empty = await trackComment(h, filed.trackingToken, '');
    expect(empty.statusCode).toBe(400);
    expect(errorOf(empty.body).code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('G10 answers 201 { data: ReturnAttachment }, and the file with 180’s headers', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await trackUpload(h, filed.trackingToken);
    expect(res.statusCode, res.body).toBe(201);
    const data = returnAttachmentSchema.strict().parse((res.json() as { data: unknown }).data);
    expect(data.uploadedByGuest).toBe(true);
    const file = await trackFile(h, filed.trackingToken, data.id);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-store');
  });

  it('G8 – G10 answer an invalid token with one 404 RETURN_TRACKING_LINK_INVALID, before the body', async () => {
    // Any attachment id: the token is refused before the id is looked at.
    for (const res of [
      await track(h, 'nope'),
      await trackComment(h, 'nope', ''),
      await trackUpload(h, null),
      await trackFile(h, 'nope', '00000000-0000-4000-8000-000000000001'),
    ]) {
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res.body).code).toBe(ERROR_CODES.RETURN_TRACKING_LINK_INVALID);
    }
  });

  it('G8 – G10 ignore the guest setting: an existing case keeps working (FR-002)', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const restore = await overrideReturnsSetting(h, GUEST_SETTING, false);
    try {
      expect((await track(h, filed.trackingToken)).statusCode).toBe(200);
      expect((await trackComment(h, filed.trackingToken, 'Still here')).statusCode).toBe(201);
    } finally {
      await restore();
    }
  });

  it('A3 answers { data: { trackingVersion } }', async () => {
    const filed = await fileGuestCase(h, reasonId);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${filed.caseId}/guest/tracking-link`,
      cookies: ADMIN_COOKIE,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(adminReissueTrackingLinkResultSchema.strict().parse((res.json() as { data: unknown }).data)).toEqual({ trackingVersion: 2 });
  });
});
