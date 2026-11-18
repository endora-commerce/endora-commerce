import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { allowGuests, fileGuestCase, trackComment, trackUpload } from './guest-fixtures.js';

/**
 * Feature 046 (FR-041 / SC-006) — status changes and settlement are audited.
 */
describe('returns — audit trail', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records a status-change audit entry on authorization', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const caseId = (created.json() as { data: { id: string } }).data.id;

    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${caseId}/authorize`, cookies: ADMIN_COOKIE });

    const entries = await h.em().find(AuditLogEntry, { objectType: 'return_case', objectId: caseId });
    const actions = entries.map((e) => e.action);
    expect(actions).toContain('return.status_changed');
    const authEntry = entries.find(
      (e) => e.action === 'return.status_changed' && (e.stateAfter as { statusCode?: string })?.statusCode === 'authorized',
    );
    expect(authEntry).toBeTruthy();
  });

  it('records that a transition had a reason, never the reason itself (#470, D-288)', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const caseId = (created.json() as { data: { id: string } }).data.id;
    const moved = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${caseId}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'authorized', reason: 'S470-REASON Jan Kowalski' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const entries = await h.em().find(AuditLogEntry, { objectType: 'return_case', objectId: caseId });
    expect(JSON.stringify(entries.map((e) => [e.stateBefore, e.stateAfter]))).not.toContain('S470');
    const transition = entries.find((e) => e.action === 'return.status_changed');
    expect(transition?.stateAfter).toEqual({ statusCode: 'authorized', hasReason: true });
  });

  /**
   * `specs/180-off-platform-complaints/` T058 (FR-B42, research R-11): filing is the
   * Command `return_case.create` — exactly one entry per case, names and counts only,
   * none for a filing that was refused, and no hand-written duplicate.
   */
  describe('return_case.create (180)', () => {
    const createEntries = (caseId: string) =>
      h.em().fork().find(AuditLogEntry, { objectType: 'return_case', objectId: caseId, action: 'return_case.create' });

    it('writes one names-only entry for an order case', async () => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const res = await file(h, { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] });
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      const entries = await createEntries(id);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.stateAfter).toEqual({
        kind: 'complaint',
        orderId,
        offPlatform: false,
        statusCode: 'new',
        lineCount: 1,
        attachmentCount: 0,
        clauseCount: 0,
        consumerWithdrawal: false,
      });
    });

    it('writes one entry for a no-order case, holding none of its personal data', async () => {
      const undo = await allowOffPlatform(h);
      try {
        const res = await file(h, noOrderBody(await complaintReasonId(h.em())), { headers: { 'x-sales-channel': 'default' } });
        expect(res.statusCode, res.body).toBe(201);
        const id = (res.json() as { data: { id: string } }).data.id;
        const entries = await createEntries(id);
        expect(entries).toHaveLength(1);
        expect(entries[0]!.stateAfter).toMatchObject({ orderId: null, offPlatform: true, lineCount: 1 });
        expect(JSON.stringify(entries[0])).not.toMatch(/Ewa|Prosta|ewa@example|SN-180|battery/i);
      } finally {
        await undo();
      }
    });

    it('writes no entry and emits no event for a refused filing', async () => {
      const seen: unknown[] = [];
      const off = h.eventBus.on('return_case.created.v1' as never, (e: unknown) => void seen.push(e));
      const before = await h.em().fork().count(AuditLogEntry, { action: 'return_case.create' });
      try {
        const { orderId, itemIds } = await seedReturnableOrder(h.em());
        const res = await file(h, {
          orderId,
          kind: 'complaint',
          lines: [{ orderItemId: itemIds[0], quantity: 99, reasonId: await anyReasonId(h.em()) }],
        });
        expect(res.statusCode).toBe(422);
        expect(await h.em().fork().count(AuditLogEntry, { action: 'return_case.create' })).toBe(before);
        expect(seen).toHaveLength(0);
      } finally {
        off();
      }
    });
  });

  /**
   * `specs/181-guest-complaints/` T077 (FR-073, FR-091; research R-6): every guest write is
   * a Command recorded once — filing, a comment and a file through the tracking link, with
   * `by: 'guest'` — and the admin's reissue and erasure once each. No entry of the case
   * carries the e-mail, the contact's name or phone, the address, a comment's body, the
   * session token or a tracking token.
   */
  describe('guest Commands (181)', () => {
    let undoGuests: () => Promise<void>;
    let undoStore: () => Promise<void>;

    beforeAll(async () => {
      undoStore = (await useTemporaryAssetStore(h)).undo;
      undoGuests = await allowGuests(h);
    });
    afterAll(async () => {
      await undoGuests();
      await undoStore();
    });

    it('records each guest write once, by the guest, and no personal value or token anywhere', async () => {
      const filed = await fileGuestCase(h, await complaintReasonId(h.em()));
      const commentBody = 'S181-COMMENT my number is 600 000 181';
      expect((await trackComment(h, filed.trackingToken, commentBody)).statusCode).toBe(201);
      expect((await trackUpload(h, filed.trackingToken)).statusCode).toBe(201);
      const reissued = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${filed.caseId}/guest/tracking-link`,
        cookies: ADMIN_COOKIE,
      });
      expect(reissued.statusCode, reissued.body).toBe(200);
      const erased = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${filed.caseId}/guest/erase`,
        cookies: ADMIN_COOKIE,
        payload: { confirm: true },
      });
      expect(erased.statusCode, erased.body).toBe(200);

      const entries = await h.em().fork().find(AuditLogEntry, { objectType: 'return_case', objectId: filed.caseId });
      const byAction = (action: string) => entries.filter((e) => e.action === action);
      const by = (action: string) => byAction(action).map((e) => (e.stateAfter as { by?: string } | null)?.by);
      expect(by('return_case.create')).toEqual(['guest']);
      expect(by('return_case.comment.add_by_guest')).toEqual(['guest']);
      // The filing's proof of purchase is part of `return_case.create`; the tracking upload is the one entry.
      expect(by('return_case.attachment.add')).toEqual(['guest']);
      expect(byAction('return_case.tracking_link.reissue')).toHaveLength(1);
      expect(byAction('return_case.guest_data.erase')).toHaveLength(1);

      const recorded = JSON.stringify(entries);
      for (const value of [
        filed.email,
        filed.email.split('@')[0]!,
        'Gość Kowalski',
        '600 000 181',
        'Prosta 2',
        '00-002',
        'S181-COMMENT',
        filed.sessionToken,
        filed.trackingToken,
      ]) {
        expect(recorded, `audit state carries ${value}`).not.toContain(value);
      }
    });
  });
});
