import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CreditLimit } from '../../../src/modules/credit_limits/entities/credit-limit.entity.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 046 (US5) — settlement: refund amounts (capped at paid), money
 * refund, store credit, replacement, and corrective invoice.
 */
describe('returns — settlement (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Create a case, authorize it, and move it to `received` so it can settle. */
  async function receivedCase(): Promise<{ id: string; itemId: string }> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string }> } }).data;
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${detail.id}/authorize`, cookies: ADMIN_COOKIE });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    return { id: detail.id, itemId: detail.items[0]!.id };
  }

  it('defaults the refund to the paid amount and issues a money refund + corrective invoice', async () => {
    const { id, itemId } = await receivedCase();

    const prefill = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/settlement`, cookies: ADMIN_COOKIE });
    const pf = (prefill.json() as { data: { items: Array<{ defaultRefundAmount: number }> } }).data;
    expect(pf.items[0]!.defaultRefundAmount).toBe(100);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }],
        refundPaymentMethodId: randomUUID(),
        createCorrectiveInvoice: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { totalRefundAmount: number; refund: { settlementState: string }; correctiveInvoiceId: string } }).data;
    expect(data.totalRefundAmount).toBe(100);
    expect(data.refund.settlementState).toBe('issued'); // bank_transfer order → recorded as issued
    expect(data.correctiveInvoiceId).toBeTruthy();

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
    expect((after.json() as { data: { statusCode: string } }).data.statusCode).toBe('resolved');
  });

  it('rejects a refund amount above the paid amount', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 999 }],
        refundPaymentMethodId: randomUUID(),
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('requires a payment method for a money refund', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'refund', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('credits the organization credit limit for a credit resolution', async () => {
    // Grant a credit limit so the top-up applies.
    const em = h.em();
    em.create(CreditLimit, { organizationId: TEST_ORGANIZATION_ID, grantedAmount: '500.00', currency: 'PLN' });
    await em.flush();

    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'credit', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }] },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { creditLimitTopupApplied: boolean; refund: { settlementState: string } } }).data;
    expect(data.creditLimitTopupApplied).toBe(true);
    expect(data.refund.settlementState).toBe('issued');

    const limit = await h.em().findOneOrFail(CreditLimit, { organizationId: TEST_ORGANIZATION_ID });
    expect(Number(limit.grantedAmount)).toBe(600);
  });

  it('issues no money for a replacement resolution', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'replacement', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 0 }] },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { refund?: unknown } }).data;
    expect(data.refund).toBeUndefined();

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
    expect((after.json() as { data: { statusCode: string } }).data.statusCode).toBe('resolved');
  });
});
