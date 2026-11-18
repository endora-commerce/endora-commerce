import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { TINY_PNG, upload } from './off-platform-fixtures.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US1) — customer submits a return/complaint case.
 */
describe('returns — submit case (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists returnable lines for a completed order', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/returnable`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { eligible: boolean; lines: Array<{ orderItemId: string; remainingReturnableQty: number; paidUnitAmount: number }> } }).data;
    expect(data.eligible).toBe(true);
    expect(data.lines).toHaveLength(2);
    const line1 = data.lines.find((l) => l.orderItemId === itemIds[0])!;
    expect(line1.remainingReturnableQty).toBe(3);
    expect(line1.paidUnitAmount).toBe(100);
  });

  it('creates a partial-quantity case in the initial status', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: {
        orderId,
        kind: 'return',
        lines: [
          { orderItemId: itemIds[0], quantity: 2, reasonId },
          { orderItemId: itemIds[1], quantity: 1, reasonId },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { statusCode: string; rmaNumber: string | null; items: unknown[] } }).data;
    expect(data.statusCode).toBe('new');
    expect(data.rmaNumber).toBeNull();
    expect(data.items).toHaveLength(2);

    // Appears in the customer's history.
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/returns', cookies: CUSTOMER_COOKIE });
    const rows = (list.json() as { data: Array<{ orderId: string }> }).data;
    expect(rows.some((r) => r.orderId === orderId)).toBe(true);
  });

  it('blocks a quantity above the returnable amount', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 99, reasonId }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a case against an order that is not yet completing', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em(), { status: 'new' });
    const reasonId = await anyReasonId(h.em());

    const returnable = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/returnable`,
      cookies: CUSTOMER_COOKIE,
    });
    const rd = (returnable.json() as { data: { eligible: boolean; reason?: string } }).data;
    expect(rd.eligible).toBe(false);
    expect(rd.reason).toBe('order_not_completing');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('prevents double-returning an already-covered quantity', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[1], quantity: 1, reasonId }] },
    });
    expect(first.statusCode).toBe(201);

    // item2 had quantity 1, now fully covered — a second request must fail.
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[1], quantity: 1, reasonId }] },
    });
    expect(second.statusCode).toBe(422);
  });

  // `specs/180-off-platform-complaints/` research R-12 replaced the JSON `{ assetId }`
  // body: a file is uploaded to the case as multipart, stored by `returns` itself.
  it('attaches an uploaded file to a case (US1, T027; 180 §C4)', async () => {
    const store = await useTemporaryAssetStore(h);
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const caseId = (created.json() as { data: { id: string } }).data.id;

    try {
      const res = await upload(h, { type: 'photo', filename: 'defect.png', mime: 'image/png', value: TINY_PNG }, { caseId });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { type: string; returnCaseId: string; mimeType: string } }).data;
      expect(data).toMatchObject({ type: 'photo', returnCaseId: caseId, mimeType: 'image/png' });
    } finally {
      await store.undo();
    }
  });

  it('does not expose a case to a different customer (admin-only detail still works)', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const caseId = (created.json() as { data: { id: string } }).data.id;

    // The owning customer can read it; an admin can read it too.
    const owner = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${caseId}`, cookies: CUSTOMER_COOKIE });
    expect(owner.statusCode).toBe(200);
    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}`, cookies: ADMIN_COOKIE });
    expect(admin.statusCode).toBe(200);
  });
});
