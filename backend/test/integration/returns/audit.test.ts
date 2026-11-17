import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';

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
});
