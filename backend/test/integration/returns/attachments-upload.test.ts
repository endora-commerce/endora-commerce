import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { ReturnCase, ReturnCaseAttachment } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { makeMember, releaseMembers, type ReturnsFixtureMember } from './organization-fixtures.js';
import {
  PROOF_REQUIRED_SETTING,
  SMALL_PDF,
  TINY_PNG,
  allowOffPlatform,
  complaintReasonId,
  file,
  noOrderBody,
  upload,
} from './off-platform-fixtures.js';
import { overrideReturnsSetting } from './notification-jobs.js';

/**
 * `specs/180-off-platform-complaints/` T064, T065 (FR-B20, FR-B21, FR-B24, research R-12):
 * pending uploads, a file added to an open case, and the claim at filing.
 */
describe('returns — uploads and attachments', () => {
  let h: BackendServerHandle;
  let undoStore: () => Promise<void>;
  let undoOffPlatform: () => Promise<void>;
  let reasonId: string;
  let colleague: ReturnsFixtureMember;
  let noCreate: ReturnsFixtureMember;
  const CHANNEL = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    undoStore = (await useTemporaryAssetStore(h)).undo;
    undoOffPlatform = await allowOffPlatform(h);
    reasonId = await complaintReasonId(h.em());
    colleague = await makeMember(h.em(), TEST_ORGANIZATION_ID, 'administrator', { label: 'Colleague180' });
    noCreate = await makeMember(h.em(), TEST_ORGANIZATION_ID, { permissions: [] }, { label: 'NoCreate180u' });
  });
  afterAll(async () => {
    await undoOffPlatform();
    await undoStore();
    releaseMembers();
    await teardownBackendServer(h);
  });

  const pdf = { type: 'proof_of_purchase', filename: 'receipt.pdf', mime: 'application/pdf', value: SMALL_PDF };
  const errorOf = (res: { json: () => unknown }) => (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
  const uploadId = async (f = pdf, cookies?: Record<string, string>): Promise<string> => {
    const res = await upload(h, f, cookies ? { cookies } : {});
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { uploadId: string } }).data.uploadId;
  };

  describe('POST /api/v1/returns/uploads (T064)', () => {
    it('stores a pending, private upload under returns/<org>/<id>, expiring in 24 h', async () => {
      const res = await upload(h, pdf);
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { uploadId: string; type: string; mimeType: string; sizeBytes: number; expiresAt: string } }).data;
      expect(data).toMatchObject({ type: 'proof_of_purchase', mimeType: 'application/pdf', sizeBytes: SMALL_PDF.length });
      const hours = (new Date(data.expiresAt).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);
      const row = await h.em().fork().findOneOrFail(ReturnCaseAttachment, { id: data.uploadId }, { filters: false });
      expect(row.returnCaseId ?? null).toBeNull();
      expect(row).toMatchObject({ organizationId: TEST_ORGANIZATION_ID, storageLocator: `returns/${TEST_ORGANIZATION_ID}/${data.uploadId}` });
    });

    it('refuses a file over 10 MB with 413 too_large', async () => {
      const big = { ...pdf, value: Buffer.concat([SMALL_PDF, Buffer.alloc(10 * 1024 * 1024 + 1)]) };
      const res = await upload(h, big);
      expect(res.statusCode).toBe(413);
      expect(errorOf(res)).toMatchObject({ code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED, details: { reason: 'too_large', maxMb: 10 } });
    });

    it('refuses a type the bytes do not identify', async () => {
      const res = await upload(h, { type: 'photo', filename: 'x.png', mime: 'image/png', value: Buffer.from('<html></html>') });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).details?.['reason']).toBe('type_not_accepted');
    });

    it('answers 400 for a request without a file', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/returns/uploads',
        cookies: { b2b_session: 'stub-customer-session' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses a member without returns.create', async () => {
      const res = await upload(h, pdf, { cookies: { b2b_session: noCreate.cookie } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/returns/:id/attachments (T064)', () => {
    async function openCase(): Promise<string> {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const res = await file(h, { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] });
      return (res.json() as { data: { id: string } }).data.id;
    }

    it('adds a file to an open case the caller filed, through return_case.attachment.add', async () => {
      const id = await openCase();
      const res = await upload(h, { type: 'photo', filename: 'p.png', mime: 'image/png', value: TINY_PNG }, { caseId: id });
      expect(res.statusCode, res.body).toBe(201);
      const entries = await h.em().fork().find(AuditLogEntry, { objectId: id, action: 'return_case.attachment.add' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.stateAfter).toMatchObject({ type: 'photo' });
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${id}`, cookies: { b2b_session: 'stub-customer-session' } });
      expect((detail.json() as { data: { attachments: Array<{ type: string }> } }).data.attachments.map((a) => a.type)).toEqual(['photo']);
    });

    it('refuses on a terminal case, on another member’s case, and beyond 10 per case', async () => {
      const closed = await openCase();
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${closed}/reject`, cookies: ADMIN_COOKIE, payload: { reason: 'x' } });
      const refused = await upload(h, pdf, { caseId: closed });
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).code).toBe('RETURN_CASE_CLOSED');

      const mine = await openCase();
      expect((await upload(h, pdf, { caseId: mine, cookies: { b2b_session: colleague.cookie } })).statusCode).toBe(404);

      for (let i = 0; i < 10; i += 1) expect((await upload(h, pdf, { caseId: mine })).statusCode).toBe(201);
      const eleventh = await upload(h, pdf, { caseId: mine });
      expect(eleventh.statusCode).toBe(422);
      expect(errorOf(eleventh).details?.['reason']).toBe('too_many');
    });
  });

  /**
   * A defect photo belongs to one product line of the case (owner request on 180): the
   * create request's `attachments[].line` is an index into its `lines`, and a later
   * upload names the line by its item id.
   */
  describe('a file tied to one line of the case', () => {
    type Detail = {
      id: string;
      items: Array<{ id: string; productName: string; orderItemId: string | null }>;
      attachments: Array<{ id: string; returnCaseItemId: string | null }>;
    };
    const photo = { type: 'photo', filename: 'defect.png', mime: 'image/png', value: TINY_PNG };
    const twoLines = () => [
      { modelName: 'Drill X200', quantity: 1, reasonId, description: 'The battery swells' },
      { modelName: 'Saw S10', quantity: 1, reasonId, description: 'The blade wobbles' },
    ];

    it('stores the photo against the line it names and a case-level file against none (no-order path)', async () => {
      const onSecond = await uploadId(photo);
      const caseLevel = await uploadId();
      const res = await file(
        h,
        noOrderBody(reasonId, { lines: twoLines(), attachments: [{ uploadId: onSecond, line: 1 }, { uploadId: caseLevel }] }),
        { headers: CHANNEL },
      );
      expect(res.statusCode, res.body).toBe(201);
      const detail = (res.json() as { data: Detail }).data;
      const saw = detail.items.find((it) => it.productName === 'Saw S10')!;
      const byId = new Map(detail.attachments.map((a) => [a.id, a.returnCaseItemId]));
      expect(byId.get(onSecond)).toBe(saw.id);
      expect(byId.get(caseLevel)).toBeNull();

      const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${detail.id}`, cookies: ADMIN_COOKIE });
      const adminAttachments = (admin.json() as { data: Detail }).data.attachments;
      expect(adminAttachments.find((a) => a.id === onSecond)?.returnCaseItemId).toBe(saw.id);
    });

    it('stores the photo against the line it names on an order case', async () => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const reason = await anyReasonId(h.em());
      const onFirst = await uploadId(photo);
      const res = await file(h, {
        orderId,
        kind: 'complaint',
        lines: [
          { orderItemId: itemIds[0], quantity: 1, reasonId: reason },
          { orderItemId: itemIds[1], quantity: 1, reasonId: reason },
        ],
        attachments: [{ uploadId: onFirst, line: 0 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      const detail = (res.json() as { data: Detail }).data;
      const first = detail.items.find((it) => it.orderItemId === itemIds[0])!;
      expect(detail.attachments).toEqual([expect.objectContaining({ id: onFirst, returnCaseItemId: first.id })]);
    });

    it('refuses a line index beyond the request’s lines as unknown_line and writes nothing', async () => {
      const pending = await uploadId(photo);
      const submissionKey = randomUUID();
      const res = await file(
        h,
        noOrderBody(reasonId, { submissionKey, attachments: [{ uploadId: pending, line: 1 }] }),
        { headers: CHANNEL },
      );
      expect(res.statusCode).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED,
        details: { reason: 'unknown_line', uploadId: pending, line: 1 },
      });
      const em = h.em().fork();
      expect(await em.count(ReturnCase, { submissionKey }, { filters: false })).toBe(0);
      const row = await em.findOneOrFail(ReturnCaseAttachment, { id: pending }, { filters: false });
      expect([row.returnCaseId ?? null, row.returnCaseItemId ?? null]).toEqual([null, null]);
      expect(row.expiresAt).not.toBeNull();

      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const order = await file(h, {
        orderId,
        kind: 'complaint',
        lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }],
        attachments: [{ uploadId: pending, line: 3 }],
      });
      expect(order.statusCode).toBe(422);
      expect(errorOf(order).details?.['reason']).toBe('unknown_line');
    });

    it('adds a later photo to a line of the case, and refuses an item of another case', async () => {
      const filed = async (): Promise<Detail> => {
        const res = await file(h, noOrderBody(reasonId, { lines: twoLines() }), { headers: CHANNEL });
        expect(res.statusCode, res.body).toBe(201);
        return (res.json() as { data: Detail }).data;
      };
      const mine = await filed();
      const other = await filed();

      const own = await upload(h, photo, { caseId: mine.id, returnCaseItemId: mine.items[1]!.id });
      expect(own.statusCode, own.body).toBe(201);
      expect((own.json() as { data: { returnCaseItemId: string | null } }).data.returnCaseItemId).toBe(mine.items[1]!.id);

      for (const foreignItem of [other.items[0]!.id, randomUUID()]) {
        const refused = await upload(h, photo, { caseId: mine.id, returnCaseItemId: foreignItem });
        expect(refused.statusCode).toBe(422);
        expect(errorOf(refused)).toMatchObject({ code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED, details: { reason: 'unknown_line' } });
      }
      const rows = await h.em().fork().find(ReturnCaseAttachment, { returnCaseId: mine.id }, { filters: false });
      expect(rows.map((r) => r.returnCaseItemId)).toEqual([mine.items[1]!.id]);
    });
  });

  describe('claiming at filing (T065)', () => {
    it('attaches the caller’s own pending uploads and clears their expiry', async () => {
      const a = await uploadId();
      const b = await uploadId({ type: 'photo', filename: 'p.png', mime: 'image/png', value: TINY_PNG });
      const res = await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: a }, { uploadId: b }] }), { headers: CHANNEL });
      expect(res.statusCode, res.body).toBe(201);
      const detail = (res.json() as { data: { id: string; attachments: Array<{ id: string; type: string }> } }).data;
      expect(detail.attachments.map((x) => x.id).sort()).toEqual([a, b].sort());
      const rows = await h.em().fork().find(ReturnCaseAttachment, { id: { $in: [a, b] } }, { filters: false });
      for (const row of rows) expect([row.returnCaseId, row.expiresAt ?? null]).toEqual([detail.id, null]);
    });

    it('refuses another customer’s, an expired and an already-claimed upload as unknown_upload', async () => {
      const foreign = await uploadId(pdf, { b2b_session: colleague.cookie });
      const expired = await uploadId();
      await h.em().fork().nativeUpdate(ReturnCaseAttachment, { id: expired }, { expiresAt: new Date(Date.now() - 1000) });
      const claimed = await uploadId();
      expect((await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: claimed }] }), { headers: CHANNEL })).statusCode).toBe(201);
      for (const id of [foreign, expired, claimed, randomUUID()]) {
        const res = await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: id }] }), { headers: CHANNEL });
        expect(res.statusCode).toBe(422);
        expect(errorOf(res)).toMatchObject({ code: ERROR_CODES.RETURN_ATTACHMENT_REJECTED, details: { reason: 'unknown_upload', uploadId: id } });
      }
    });

    it('refuses more than 30 MB together', async () => {
      const big = { ...pdf, value: Buffer.concat([SMALL_PDF, Buffer.alloc(9 * 1024 * 1024)]) };
      const ids = [await uploadId(big), await uploadId(big), await uploadId(big), await uploadId(big)];
      const res = await file(h, noOrderBody(reasonId, { attachments: ids.map((uploadId) => ({ uploadId })) }), { headers: CHANNEL });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).details?.['reason']).toBe('submission_too_large');
    });

    it('requires a proof of purchase on a no-order complaint while the setting is on, and not on an order case', async () => {
      const undo = await overrideReturnsSetting(h, PROOF_REQUIRED_SETTING, true);
      try {
        const photo = await uploadId({ type: 'photo', filename: 'p.png', mime: 'image/png', value: TINY_PNG });
        const refused = await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: photo }] }), { headers: CHANNEL });
        expect(refused.statusCode).toBe(422);
        expect(errorOf(refused).code).toBe(ERROR_CODES.RETURN_PROOF_OF_PURCHASE_REQUIRED);
        const proof = await uploadId();
        expect((await file(h, noOrderBody(reasonId, { attachments: [{ uploadId: proof }] }), { headers: CHANNEL })).statusCode).toBe(201);
        const { orderId, itemIds } = await seedReturnableOrder(h.em());
        const order = await file(h, { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] });
        expect(order.statusCode).toBe(201);
      } finally {
        await undo();
      }
    });
  });
});
