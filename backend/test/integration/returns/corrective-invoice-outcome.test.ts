import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Refund } from '../../../src/modules/returns/entities/refund.entity.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { setSellerSettings } from '../invoices/helpers.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * The corrective-invoice outcome survives a reload (D-92, issue #156).
 *
 * The three-way answer — issued / not due / not requested — was assembled into
 * the settlement *response* and into the audit entry, and nowhere else. The
 * `Refund` row persisted `correctiveInvoiceId` alone, so after a refresh
 * `null` meant "not due", "not requested" and "asked for, and we do not know"
 * at once — which is the confusion the explicit `reason` field was added to
 * prevent (#135). The column is the persisted discriminant; this file reads it
 * back through the case-detail endpoint, which is what a reloaded screen does.
 */
describe('returns — the corrective-invoice outcome is persisted (D-92)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function receivedCase(): Promise<{ id: string; itemId: string; orderId: string }> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string }> } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/authorize`,
      cookies: ADMIN_COOKIE,
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    return { id: detail.id, itemId: detail.items[0]!.id, orderId };
  }

  async function settleRefund(
    id: string,
    itemId: string,
    createCorrectiveInvoice: boolean,
  ): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }],
        refundPaymentMethodId: randomUUID(),
        createCorrectiveInvoice,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** What a reloaded screen reads: the case detail, not the settlement response. */
  async function reloadedOutcome(
    id: string,
  ): Promise<{ outcome: string; invoiceId: string | null } | null> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    return (
      res.json() as {
        data: { correctiveInvoice: { outcome: string; invoiceId: string | null } | null };
      }
    ).data.correctiveInvoice;
  }

  const persistedOutcome = (id: string): Promise<string> =>
    withSystemScope('test: read the refund row', async () =>
      (await h.em().fork().findOneOrFail(Refund, { returnCaseId: id })).correctiveInvoiceOutcome,
    );

  it('records `not_due` when the order was never invoiced', async () => {
    const { id, itemId } = await receivedCase();
    await settleRefund(id, itemId, true);

    expect(await persistedOutcome(id)).toBe('not_due');
    expect(await reloadedOutcome(id)).toEqual({ outcome: 'not_due', invoiceId: null });
  });

  it('records `not_requested` when the operator declined the correction', async () => {
    const { id, itemId } = await receivedCase();
    await settleRefund(id, itemId, false);

    expect(await persistedOutcome(id)).toBe('not_requested');
    expect(await reloadedOutcome(id)).toEqual({ outcome: 'not_requested', invoiceId: null });
  });

  /**
   * The counterpart the other two need: without it "always `not_due`" passes
   * both of them. One issuance in this file, deliberately — the invoice number
   * counter is per (channel, kind, year) while `invoices.number` is globally
   * unique, so two orders on two fresh channels both draw sequence 1.
   */
  it('records `issued` with the document id when the order was invoiced', async () => {
    const { id, itemId, orderId } = await receivedCase();
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);

    await settleRefund(id, itemId, true);

    expect(await persistedOutcome(id)).toBe('issued');
    const reloaded = await reloadedOutcome(id);
    expect(reloaded?.outcome).toBe('issued');
    expect(reloaded?.invoiceId).toBeTruthy();
  });

  it('carries no corrective-invoice answer for a case that moved no money', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'replacement',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 0 }],
      },
    });
    expect(res.statusCode).toBe(200);

    // No refund row, so no outcome — a replacement corrects no document and
    // "not requested" would claim an answer nobody was asked for.
    expect(await reloadedOutcome(id)).toBeNull();
  });
});
