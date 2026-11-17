import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ReturnCaseAttachment } from '../../helpers/package-entities.js';
import { resetReturnGraph } from './helpers.js';
import { SMALL_PDF, complaintReasonId, file, noOrderBody, upload } from './off-platform-fixtures.js';
import { allowGuests, caseIdOfToken, fileAsGuest, guestBody, guestUpload, openGuestSession } from './guest-fixtures.js';

/**
 * `specs/181-guest-complaints/` T026 (US1; FR-035; research R-1, R-4): a guest's pending
 * uploads (G6) belong to the guest session that sent them.
 *
 * - The row has no account and no organization, carries the session, and its bytes sit
 *   under `returns/guest/<id>`.
 * - Only that session can claim it: another session and a customer cannot, and a guest
 *   cannot claim a customer's upload — each is `unknown_upload`.
 * - A session holds at most 10 pending uploads.
 */
describe('returns — a guest’s pending uploads', () => {
  let h: BackendServerHandle;
  let reasonId: string;
  let undo: () => Promise<void>;

  const PDF = { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF };
  const uploadIdOf = (res: { json: () => unknown }) => (res.json() as { data: { uploadId: string } }).data.uploadId;
  const rejection = (res: { json: () => unknown }) =>
    (res.json() as { error: { code: string; details: { reason: string } } }).error;

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

  it('stores an upload owned by the session, with no account or organization, under returns/guest/', async () => {
    const session = await openGuestSession(h);
    const res = await guestUpload(h, session.sessionToken, PDF);
    expect(res.statusCode, res.body).toBe(201);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ type: 'proof_of_purchase', filename: 'receipt.pdf', mimeType: 'application/pdf' });
    const row = await h.em().fork().findOneOrFail(ReturnCaseAttachment, { id: data['uploadId'] as string }, { filters: false });
    expect(row.guestSessionId).toBe(session.verificationId);
    expect(row.uploadedByGuest).toBe(true);
    expect(row.customerAccountId ?? null).toBeNull();
    expect(row.organizationId ?? null).toBeNull();
    expect(row.returnCaseId ?? null).toBeNull();
    expect(row.storageLocator).toBe(`returns/guest/${row.id}`);
    expect(row.expiresAt).toBeInstanceOf(Date);
  });

  it('lets the session claim its own upload when it files', async () => {
    const session = await openGuestSession(h);
    const uploadId = uploadIdOf(await guestUpload(h, session.sessionToken, PDF));
    const res = await fileAsGuest(h, session.sessionToken, guestBody(reasonId, { attachments: [{ uploadId }] }));
    expect(res.statusCode, res.body).toBe(201);
    const caseId = caseIdOfToken(h, (res.json() as { data: { trackingToken: string } }).data.trackingToken);
    const row = await h.em().fork().findOneOrFail(ReturnCaseAttachment, { id: uploadId }, { filters: false });
    expect(row.returnCaseId).toBe(caseId);
    expect(row.expiresAt ?? null).toBeNull();
    expect(row.guestSessionId).toBe(session.verificationId);
  });

  it('refuses another session’s upload and a customer’s upload as unknown', async () => {
    const owner = await openGuestSession(h);
    const thief = await openGuestSession(h);
    const guestUploadId = uploadIdOf(await guestUpload(h, owner.sessionToken, PDF));
    const stolen = await fileAsGuest(h, thief.sessionToken, guestBody(reasonId, { attachments: [{ uploadId: guestUploadId }] }));
    expect(stolen.statusCode).toBe(422);
    expect(rejection(stolen)).toMatchObject({ code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED, details: { reason: 'unknown_upload' } });

    const customerUpload = await upload(h, PDF);
    expect(customerUpload.statusCode, customerUpload.body).toBe(201);
    const borrowed = await fileAsGuest(h, thief.sessionToken, guestBody(reasonId, { attachments: [{ uploadId: uploadIdOf(customerUpload) }] }));
    expect(borrowed.statusCode).toBe(422);
    expect(rejection(borrowed).details.reason).toBe('unknown_upload');
  });

  it('refuses a guest’s upload to a customer’s filing as unknown', async () => {
    const session = await openGuestSession(h);
    const uploadId = uploadIdOf(await guestUpload(h, session.sessionToken, PDF));
    const res = await file(h, noOrderBody(reasonId, { attachments: [{ uploadId }] }), { headers: { 'x-sales-channel': 'default' } });
    expect(res.statusCode).toBe(422);
    expect(rejection(res).details.reason).toBe('unknown_upload');
    const row = await h.em().fork().findOneOrFail(ReturnCaseAttachment, { id: uploadId }, { filters: false });
    expect(row.returnCaseId ?? null).toBeNull();
  });

  it('holds at most 10 pending uploads per session', async () => {
    const session = await openGuestSession(h);
    for (let i = 0; i < 10; i += 1) expect((await guestUpload(h, session.sessionToken, PDF)).statusCode).toBe(201);
    const eleventh = await guestUpload(h, session.sessionToken, PDF);
    expect(eleventh.statusCode).toBe(422);
    expect(rejection(eleventh)).toMatchObject({ code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED, details: { reason: 'too_many' } });
  });

  it('refuses an upload without a live session', async () => {
    const res = await guestUpload(h, null, PDF);
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED);
  });
});
