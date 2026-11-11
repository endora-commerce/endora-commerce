import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moneyDifference } from '@endora-commerce/contracts';
import { Invoice, InvoiceLine, Order, OrderItem, Organization, Refund } from '../../helpers/package-entities.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { setSellerSettings } from '../invoices/helpers.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph } from './helpers.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { makeMember, makeOrganization, releaseMembers, type ReturnsFixtureMember } from './organization-fixtures.js';
import { RETURNS_SETTING_CODES } from '../../../../packages/modules/returns/src/manifest.js';

/**
 * Issue #876 — a consumer's withdrawal from the whole sale refunds the delivery
 * cost and the payment surcharge (Directive 2011/83 art. 13(1), PL art. 32
 * ust. 1). Owner rulings of 2026-11-07 (E1–E3): the case that completes the
 * withdrawal refunds both, a partial one neither; the default applies within
 * the statutory 14 days or the channel's longer free-return window, and the
 * operator may refund up to what was paid outside it. A business customer's
 * return and a complaint are unchanged.
 *
 * Every order: 2 × 50.00 net at 23 % (123.00 gross), plus the delivery.
 */
const ACTOR = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

interface CaseDetail {
  id: string;
  totalRefundAmount: number;
  items: Array<{ id: string; quantity: number; defaultRefundAmount: number; approvedRefundAmount: number }>;
  chargeRefunds?: { delivery: number; surcharge: number };
}

interface Prefill {
  items: Array<{ returnCaseItemId: string; defaultRefundAmount: number; approvedRefundAmount: number }>;
  charges?: {
    delivery?: { cap: number; approved: number };
    surcharge?: { cap: number; approved: number };
  };
}

describe('returns — a consumer withdrawal refunds the delivery and the surcharge (#876)', () => {
  let h: BackendServerHandle;
  let CH: string;
  let CH_NO_FREE: string;
  let consumer: ReturnsFixtureMember;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'ret-withdrawal');
    CH_NO_FREE = await ensureSalesChannelId(h.em(), 'ret-withdrawal-0');
    await resetReturnGraph(h.em());
    await setSellerSettings(h);
    for (const code of ['ret-withdrawal', 'ret-withdrawal-0']) {
      await h.settings.adminService.setValueForSubset(
        'invoices.numbering.invoice.pattern',
        [code],
        `FVWD${code.endsWith('0') ? '0' : ''} {seq}/{YYYY}`,
        null,
        ACTOR,
      );
      await h.settings.adminService.setValueForSubset(
        'invoices.numbering.correction.pattern',
        [code],
        `KORWD${code.endsWith('0') ? '0' : ''} {seq}/{YYYY}`,
        null,
        ACTOR,
      );
    }
    // A channel that offers no free return: the statutory 14 days still hold.
    await h.settings.adminService.setValueForSubset(RETURNS_SETTING_CODES.FREE_RETURN_DAYS, ['ret-withdrawal-0'], 0, null, ACTOR);

    // A consumer: a personal Organization (B2C).
    const em = h.em().fork();
    const orgId = await makeOrganization(em, 'Consumer');
    await withSystemScope('test: make the organization personal', async () => {
      const fork = h.em().fork();
      const org = await fork.findOneOrFail(Organization, { id: orgId });
      org.isPersonal = true;
      org.taxId = null; // a personal organization has no tax ID (specs/177-tax-id-scope/)
      await fork.flush();
    });
    consumer = await makeMember(h.em().fork(), orgId, 'administrator', { label: 'Consumer' });
  });

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  /** A completed, paid per-rate order: 2 × 50.00 at 23 % plus `delivery`, and `surcharge` on the payment method. */
  async function seedOrder(
    opts: {
      buyer?: 'consumer' | 'business';
      delivery?: string;
      surcharge?: number;
      channel?: string;
      completedDaysAgo?: number;
      nonReturnableLine?: boolean;
    } = {},
  ): Promise<{ orderId: string; item: string; other?: string }> {
    const business = opts.buyer === 'business';
    const delivery = opts.delivery ?? '15.99';
    const surcharge = opts.surcharge ?? 0;
    const extra = opts.nonReturnableLine ? 12.3 : 0;
    const em = h.em().fork();
    const order = em.create(Order, {
      organizationId: business ? TEST_ORGANIZATION_ID : consumer.organizationId,
      placedByCustomerAccountId: business ? TEST_CUSTOMER_ID : consumer.id,
      salesChannelId: opts.channel ?? CH,
      status: 'completed',
      paymentStatus: 'paid',
      vatMethod: 'per_rate',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'Jan Kowalski', street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-002', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: Number(delivery) },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: {
        code: 'pm',
        name: 'Przelew',
        kind: 'bank_transfer',
        ...(surcharge > 0 ? { additionalPrice: surcharge } : {}),
      },
      subtotal: opts.nonReturnableLine ? '110.00' : '100.00',
      taxTotal: opts.nonReturnableLine ? '25.30' : '23.00',
      deliveryTotal: delivery,
      discountTotal: '0.00',
      total: (123 + extra + Number(delivery) + surcharge).toFixed(2),
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const item = em.create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'WD-1', name: 'Kettle', primaryAssetUrl: null },
      quantity: 2,
      position: 0,
      unitPrice: '50.00',
      taxRate: '0.2300',
      lineTotal: '123.00',
      returnableAtPurchase: true,
    });
    const other = opts.nonReturnableLine
      ? em.create(OrderItem, {
          orderId: order.id,
          productId: randomUUID(),
          productSnapshot: { sku: 'WD-2', name: 'Made to measure', primaryAssetUrl: null },
          quantity: 1,
          position: 1,
          unitPrice: '10.00',
          taxRate: '0.2300',
          lineTotal: '12.30',
          returnableAtPurchase: false,
        })
      : null;
    await em.persistAndFlush(other ? [item, other] : [item]);
    if (opts.completedDaysAgo) {
      // The order entered `completed` that long ago: `orders.completed_at`, the withdrawal period's anchor (#905).
      await em
        .getKnex()
        .raw(`update orders set completed_at = now() - (? * interval '1 day') where id = ?`, [opts.completedDaysAgo, order.id]);
    }
    return { orderId: order.id, item: item.id, ...(other ? { other: other.id } : {}) };
  }

  async function openCase(
    orderId: string,
    lines: Array<{ orderItemId: string; quantity: number }>,
    opts: { kind?: 'return' | 'complaint'; buyer?: 'consumer' | 'business' } = {},
  ): Promise<CaseDetail> {
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: opts.buyer === 'business' ? CUSTOMER_COOKIE : { b2b_session: consumer.cookie },
      payload: { orderId, kind: opts.kind ?? 'return', lines: lines.map((l) => ({ ...l, reasonId })) },
    });
    expect(res.statusCode, res.body).toBe(201);
    const detail = (res.json() as { data: CaseDetail }).data;
    for (const step of [
      { url: `/api/v1/admin/returns/${detail.id}/authorize` },
      { url: `/api/v1/admin/returns/${detail.id}/transition`, payload: { to: 'received' } },
    ]) {
      const moved = await h.app.inject({ method: 'POST', cookies: ADMIN_COOKIE, ...step });
      expect(moved.statusCode, moved.body).toBe(200);
    }
    return detail;
  }

  async function prefill(caseId: string): Promise<Prefill> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${caseId}/settlement`, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Prefill }).data;
  }

  /** Settle with every line at its prefilled amount; `charges` names the charge fields to send, if any. */
  async function settleRaw(
    caseId: string,
    charges: { deliveryRefundAmount?: number; surchargeRefundAmount?: number } = {},
    resolutionType: 'refund' | 'replacement' = 'refund',
  ) {
    const p = await prefill(caseId);
    const money = resolutionType === 'refund';
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${caseId}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType,
        ...(money ? { refundPaymentMethodId: randomUUID() } : {}),
        lines: p.items.map((it) => ({
          returnCaseItemId: it.returnCaseItemId,
          approvedRefundAmount: money ? it.approvedRefundAmount : 0,
        })),
        ...charges,
      },
    });
  }

  async function settle(caseId: string, charges: { deliveryRefundAmount?: number; surchargeRefundAmount?: number } = {}) {
    const res = await settleRaw(caseId, charges);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { totalRefundAmount: number; correctiveInvoiceId?: string | null } }).data;
  }

  const refundOf = (caseId: string) =>
    withSystemScope('test: read the refund', () => h.em().fork().findOneOrFail(Refund, { returnCaseId: caseId }));

  async function issueInvoice(orderId: string) {
    return h.app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/invoices`, cookies: ADMIN_COOKIE, payload: { kind: 'invoice' } });
  }

  it('a full return in one case refunds 123.00 + 15.99 = 138.99, and the order is not invoiced afterwards', async () => {
    const { orderId, item } = await seedOrder();
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    // The case shows the delivery refund from the start (provisional basis).
    expect(rc.chargeRefunds).toEqual({ delivery: 15.99, surcharge: 0 });
    expect((await prefill(rc.id)).charges).toEqual({ delivery: { cap: 15.99, approved: 15.99 } });

    expect((await settle(rc.id)).totalRefundAmount).toBe(138.99);
    expect((await refundOf(rc.id)).amount).toBe('138.99');
    // Ruling Q4 — a settled case shows what it settled at: the cap is the approved amount.
    expect((await prefill(rc.id)).charges).toEqual({ delivery: { cap: 15.99, approved: 15.99 } });

    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${rc.id}`, cookies: { b2b_session: consumer.cookie } });
    expect(detail.statusCode, detail.body).toBe(200);
    expect((detail.json() as { data: CaseDetail }).data).toMatchObject({
      totalRefundAmount: 138.99,
      chargeRefunds: { delivery: 15.99, surcharge: 0 },
    });

    // Nothing kept and everything refunded: there is no sale left to invoice.
    const invoice = await issueInvoice(orderId);
    expect(invoice.statusCode, invoice.body).toBe(422);
  });

  it('E3 — the payment surcharge is refunded as well: 123.00 + 15.99 + 2.50 = 141.49', async () => {
    const { orderId, item } = await seedOrder({ surcharge: 2.5 });
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    expect((await prefill(rc.id)).charges).toEqual({
      delivery: { cap: 15.99, approved: 15.99 },
      surcharge: { cap: 2.5, approved: 2.5 },
    });
    expect((await settle(rc.id)).totalRefundAmount).toBe(141.49);
  });

  it('E1 — two partial cases refund 61.50, then 61.50 + 15.99', async () => {
    const { orderId, item } = await seedOrder();
    const first = await openCase(orderId, [{ orderItemId: item, quantity: 1 }]);
    expect((await prefill(first.id)).charges).toBeUndefined();
    expect((await settle(first.id)).totalRefundAmount).toBe(61.5);

    const second = await openCase(orderId, [{ orderItemId: item, quantity: 1 }]);
    expect((await settle(second.id)).totalRefundAmount).toBe(77.49);
  });

  it('E1 — the operator cannot add the delivery to a partial case', async () => {
    const { orderId, item } = await seedOrder();
    const first = await openCase(orderId, [{ orderItemId: item, quantity: 1 }]);
    const res = await settleRaw(first.id, { deliveryRefundAmount: 15.99 });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { details?: { code?: string } } }).error.details?.code).toBe('refund_exceeds_paid');
  });

  it('art. 13(2) — a premium delivery of 29.99 reduced to 15.99: the kept-lines invoice prints the delivery 14.00 alone', async () => {
    const { orderId, item } = await seedOrder({ delivery: '29.99' });
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    expect((await settle(rc.id, { deliveryRefundAmount: 15.99 })).totalRefundAmount).toBe(138.99);

    const res = await issueInvoice(orderId);
    expect(res.statusCode, res.body).toBe(201);
    const invoice = (res.json() as {
      data: { grossTotal: number; paidTotal: number; amountDue: number; lines: Array<{ netValue: number; grossValue: number; orderItemId?: string | null }> };
    }).data;
    expect(invoice.lines.map((l) => l.grossValue)).toEqual([14]);
    expect([invoice.grossTotal, invoice.paidTotal, invoice.amountDue]).toEqual([14, 14, 0]);
  });

  it('invoice issued first: the correction credits 23 % 100.00 / 23.00 and the 0 % delivery 15.99, and the invoice nets to 0', async () => {
    const { orderId, item } = await seedOrder();
    const issued = await issueInvoice(orderId);
    expect(issued.statusCode, issued.body).toBe(201);
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    const result = await settle(rc.id);
    expect(result.totalRefundAmount).toBe(138.99);

    const { original, correction, lines } = await withSystemScope('test: read the documents', async () => {
      const em = h.em().fork();
      const original = await em.findOneOrFail(Invoice, { orderId, kind: 'invoice' });
      const correction = await em.findOneOrFail(Invoice, { originalInvoiceId: original.id, kind: 'correction' });
      const lines = await em.find(InvoiceLine, { invoiceId: correction.id }, { orderBy: { ordinal: 'asc' } });
      return { original, correction, lines };
    });
    expect(correction.total).toBe('138.99');
    expect(moneyDifference(original.total, correction.total)).toBe('0.00');
    expect(lines.map((l) => [l.taxRate, l.netValue, l.grossValue, l.lineKind ?? null])).toEqual([
      ['0.2300', '100.00', '123.00', null],
      ['0.0000', '15.99', '15.99', 'delivery'],
    ]);
  });

  it('a business customer’s full return is unchanged: 123.00, the delivery stays', async () => {
    const { orderId, item } = await seedOrder({ buyer: 'business' });
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }], { buyer: 'business' });
    expect((await prefill(rc.id)).charges).toBeUndefined();
    expect((await settle(rc.id)).totalRefundAmount).toBe(123);
  });

  it('a consumer’s complaint is unchanged: no delivery refund', async () => {
    const { orderId, item } = await seedOrder();
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }], { kind: 'complaint' });
    expect((await prefill(rc.id)).charges).toBeUndefined();
    expect((await settle(rc.id)).totalRefundAmount).toBe(123);
  });

  it('an order with a non-returnable line can never be withdrawn in full, so it never refunds the delivery', async () => {
    const { orderId, item } = await seedOrder({ nonReturnableLine: true });
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    expect((await prefill(rc.id)).charges).toBeUndefined();
    expect((await settle(rc.id)).totalRefundAmount).toBe(123);
  });

  it('E2 — a channel with free_return_days = 0 still refunds it within the statutory 14 days', async () => {
    const { orderId, item } = await seedOrder({ channel: CH_NO_FREE, completedDaysAgo: 3 });
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    expect((await settle(rc.id)).totalRefundAmount).toBe(138.99);
  });

  it('E2 — after the window the default is 0; the operator may refund up to what was paid, and no more', async () => {
    const late = await seedOrder({ completedDaysAgo: 20 });
    const rc = await openCase(late.orderId, [{ orderItemId: late.item, quantity: 2 }]);
    expect((await prefill(rc.id)).charges).toEqual({ delivery: { cap: 15.99, approved: 0 } });
    const refused = await settleRaw(rc.id, { deliveryRefundAmount: 16 });
    expect(refused.statusCode, refused.body).toBe(422);
    expect((await settle(rc.id, { deliveryRefundAmount: 15.99 })).totalRefundAmount).toBe(138.99);

    const untouched = await seedOrder({ completedDaysAgo: 20 });
    const other = await openCase(untouched.orderId, [{ orderItemId: untouched.item, quantity: 2 }]);
    expect((await settle(other.id)).totalRefundAmount).toBe(123);
  });

  /**
   * Ruling Q2 on PR #965 — a present charge amount settles exactly, 0 included;
   * only an omitted one takes the default recomputed under the lock. Two cases
   * of one unit each: the second opened shows the delivery provisionally, but
   * settled first it does not complete the withdrawal, so its cap is 0; the
   * first, opened partial, completes once the other is settled.
   */
  async function twoCases() {
    const { orderId, item } = await seedOrder();
    const first = await openCase(orderId, [{ orderItemId: item, quantity: 1 }]);
    const second = await openCase(orderId, [{ orderItemId: item, quantity: 1 }]);
    expect([first.chargeRefunds?.delivery, second.chargeRefunds?.delivery]).toEqual([0, 15.99]);
    return { first, second };
  }

  it('Q2 — a stale figure above a cap that has shrunk is refused, and nothing is written', async () => {
    const { second } = await twoCases();
    // The case showed 15.99 when it was opened; settled first, it no longer completes.
    expect((await prefill(second.id)).charges).toBeUndefined();
    const refused = await settleRaw(second.id, { deliveryRefundAmount: 15.99 });
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as { error: { details?: { code?: string } } }).error.details?.code).toBe('refund_exceeds_paid');
    // Omitted, it settles at the recomputed default: no delivery.
    expect((await settle(second.id)).totalRefundAmount).toBe(61.5);
  });

  it('Q2 — on the case that completes it, an omitted amount settles the full delivery', async () => {
    const { first, second } = await twoCases();
    expect((await settle(second.id)).totalRefundAmount).toBe(61.5);
    expect((await prefill(first.id)).charges).toEqual({ delivery: { cap: 15.99, approved: 15.99 } });
    expect((await settle(first.id)).totalRefundAmount).toBe(77.49);
  });

  it('Q2 — on the case that completes it, an explicit 0 settles at 0', async () => {
    const { first, second } = await twoCases();
    expect((await settle(second.id)).totalRefundAmount).toBe(61.5);
    expect((await settle(first.id, { deliveryRefundAmount: 0 })).totalRefundAmount).toBe(61.5);
    // Q4 — a settled charge of 0 is not shown.
    expect((await prefill(first.id)).charges).toBeUndefined();
  });

  it('Q1 — a replacement that completes the order refunds no charge; the kept-lines invoice still charges the delivery', async () => {
    const { orderId, item } = await seedOrder();
    const rc = await openCase(orderId, [{ orderItemId: item, quantity: 2 }]);
    // A consumer withdrawal settles otherwise than by a refund only with consent on record (#905).
    const consent = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${rc.id}/alternative-consent`,
      cookies: ADMIN_COOKIE,
      payload: { resolution: 'replacement', consentGivenAt: new Date().toISOString(), note: 'Asked for a replacement' },
    });
    expect(consent.statusCode, consent.body).toBe(200);
    const refused = await settleRaw(rc.id, { deliveryRefundAmount: 15.99 }, 'replacement');
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as { error: { details?: { code?: string } } }).error.details?.code).toBe('refund_exceeds_paid');

    const res = await settleRaw(rc.id, {}, 'replacement');
    expect(res.statusCode, res.body).toBe(200);
    // The money moved is the sum of the lines: none for a replacement.
    expect((res.json() as { data: { totalRefundAmount: number } }).data.totalRefundAmount).toBe(0);
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${rc.id}`, cookies: ADMIN_COOKIE });
    expect((detail.json() as { data: CaseDetail }).data.chargeRefunds).toEqual({ delivery: 0, surcharge: 0 });

    const invoice = await issueInvoice(orderId);
    expect(invoice.statusCode, invoice.body).toBe(201);
    const data = (invoice.json() as { data: { grossTotal: number; lines: Array<{ grossValue: number }> } }).data;
    expect(data.lines.map((l) => l.grossValue).sort((a, b) => a - b)).toEqual([15.99, 123]);
    expect(data.grossTotal).toBe(138.99);
  });
});

