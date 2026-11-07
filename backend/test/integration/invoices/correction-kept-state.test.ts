import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareDecimals, moneyDifference, moneySum, roundHalfUp } from '@endora-commerce/contracts';
import { CreditLimit, Invoice, InvoiceLine, Order, OrderItem, Refund, ReturnCase } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN_COOKIE, setSellerSettings } from './helpers.js';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph } from '../returns/helpers.js';

let CH: string;

type Rows = Map<string, { net: string; vat: string; gross: string }>;

/**
 * Issue #873 — a correction is anchored on what the invoice keeps. An order
 * invoiced first and then returned (corrections) ends with the same per-rate
 * figures, to the cent, as the same order returned first and then invoiced (a
 * kept-lines invoice, #435), and both equal what is left paid.
 *
 * Issue #885 — a complaint settled with money after invoicing is a price
 * reduction: the correction credits the approved amount at the line's rate,
 * stored with quantity 0 under the price-reduction label, with no discount, and
 * it lowers no kept quantity. Replacement and repair issue no correction.
 */
describe('invoices — a correction leaves what the invoice keeps (#873, #885)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-kept-state');
    await resetReturnGraph(h.em());
    await setSellerSettings(h);
    for (const [key, pattern] of [
      ['invoices.numbering.invoice.pattern', 'FVKS {seq}/{YYYY}'],
      ['invoices.numbering.correction.pattern', 'KORKS {seq}/{YYYY}'],
    ] as const) {
      await h.settings.adminService.setValueForSubset(key, ['inv-kept-state'], pattern, null, {
        actorAdminUserId: '00000000-0000-0000-0000-000000000000',
      });
    }
    const em = h.em().fork();
    if (!(await em.findOne(CreditLimit, { organizationId: TEST_ORGANIZATION_ID }))) {
      em.create(CreditLimit, { organizationId: TEST_ORGANIZATION_ID, grantedAmount: '500.00', currency: 'PLN' });
      await em.flush();
    }
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  interface SeedLine {
    name: string;
    unitPrice: string;
    quantity: number;
    taxRate: string;
    /** The line's own gross, informational, as placement stores it. */
    lineTotal: string;
  }

  /** A completed, paid per-rate order, the way `OrderService.placeOrder` writes one. */
  async function seedOrder(
    lines: SeedLine[],
    totals: { subtotal: string; taxTotal: string; discount?: string; delivery?: string; surcharge?: string },
  ): Promise<{ orderId: string; items: string[]; total: string }> {
    const em = h.em().fork();
    const discount = totals.discount ?? '0.00';
    const delivery = totals.delivery ?? '0.00';
    const surcharge = totals.surcharge ?? '0.00';
    const total = moneyDifference(moneySum([totals.subtotal, totals.taxTotal, delivery, surcharge]), discount);
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: CH,
      status: 'completed',
      paymentStatus: 'paid',
      vatMethod: 'per_rate',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: {
        recipientName: 'Jan Kowalski',
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-002',
        country: 'PL',
        companyName: 'Example Buyer Sp. z o.o.',
        taxId: '1231231230',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: Number(delivery) },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: {
        code: 'pm',
        name: 'Przelew',
        kind: 'bank_transfer',
        ...(compareDecimals(surcharge, 0) > 0 ? { additionalPrice: surcharge } : {}),
      },
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      deliveryTotal: delivery,
      discountTotal: discount,
      total,
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const items = lines.map((l, position) =>
      em.create(OrderItem, {
        orderId: order.id,
        productId: randomUUID(),
        productSnapshot: { sku: `KS-${position}`, name: l.name, primaryAssetUrl: null },
        quantity: l.quantity,
        position,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        lineTotal: l.lineTotal,
      }),
    );
    await em.persistAndFlush(items);
    return { orderId: order.id, items: items.map((i) => i.id), total };
  }

  const BOLT: SeedLine = { name: 'Bolt', unitPrice: '10.0100', quantity: 3, taxRate: '0.2300', lineTotal: '36.94' };
  const WASHER: SeedLine = { name: 'Washer', unitPrice: '4.9950', quantity: 2, taxRate: '0.0800', lineTotal: '10.79' };

  const seedBolts = () => seedOrder([BOLT], { subtotal: '30.03', taxTotal: '6.91' });
  /** Two rates, a 5.00 order discount, 10.00 delivery and a 2.50 surcharge. */
  const seedTwoRate = () =>
    seedOrder([BOLT, WASHER], { subtotal: '40.02', taxTotal: '7.71', discount: '5.00', delivery: '10.00', surcharge: '2.50' });

  /** Submit a case, authorize it, receive it and settle it; `amounts` overrides the approved amount per line. */
  async function settleCase(
    orderId: string,
    lines: Array<{ orderItemId: string; quantity: number }>,
    opts: {
      kind?: 'return' | 'complaint';
      resolutionType?: 'refund' | 'credit' | 'replacement' | 'repair';
      amounts?: number[];
    } = {},
  ): Promise<{ caseId: string; rmaNumber: string; correctiveInvoiceId: string | null }> {
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: opts.kind ?? 'return', lines: lines.map((l) => ({ ...l, reasonId })) },
    });
    expect(created.statusCode, created.body).toBe(201);
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string; defaultRefundAmount: number }> } }).data;
    const authorized = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${detail.id}/authorize`, cookies: ADMIN_COOKIE });
    expect(authorized.statusCode, authorized.body).toBe(200);
    const rmaNumber = (authorized.json() as { data: { rmaNumber: string } }).data.rmaNumber;
    const received = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    expect(received.statusCode, received.body).toBe(200);
    const resolutionType = opts.resolutionType ?? 'refund';
    const movesMoney = resolutionType === 'refund' || resolutionType === 'credit';
    const settled = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType,
        lines: detail.items.map((it, i) => ({
          returnCaseItemId: it.id,
          approvedRefundAmount: movesMoney ? (opts.amounts?.[i] ?? it.defaultRefundAmount) : 0,
        })),
        ...(resolutionType === 'refund' ? { refundPaymentMethodId: randomUUID() } : {}),
      },
    });
    expect(settled.statusCode, settled.body).toBe(200);
    const result = (settled.json() as { data: { correctiveInvoiceId?: string | null } }).data;
    return { caseId: detail.id, rmaNumber, correctiveInvoiceId: result.correctiveInvoiceId ?? null };
  }

  async function issueInvoice(orderId: string): Promise<Invoice> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return h.em().fork().findOneOrFail(Invoice, { orderId, kind: 'invoice' });
  }

  const rowsOf = (invoice: Invoice): Rows =>
    new Map(
      (invoice.vatSummary ?? []).map((r) => [
        roundHalfUp(r.taxRate, 4),
        { net: roundHalfUp(r.netTotal), vat: roundHalfUp(r.vatAmount), gross: roundHalfUp(r.grossTotal) },
      ]),
    );

  /** The invoice's per-rate summary less every correction issued against it. */
  async function keptRows(orderId: string): Promise<{ rows: Rows; gross: string }> {
    const em = h.em().fork();
    const invoice = await em.findOneOrFail(Invoice, { orderId, kind: 'invoice' });
    const corrections = await em.find(Invoice, { originalInvoiceId: invoice.id, kind: 'correction' });
    const rows = rowsOf(invoice);
    for (const c of corrections) {
      for (const [rate, r] of rowsOf(c)) {
        const cur = rows.get(rate) ?? { net: '0.00', vat: '0.00', gross: '0.00' };
        rows.set(rate, {
          net: moneyDifference(cur.net, r.net),
          vat: moneyDifference(cur.vat, r.vat),
          gross: moneyDifference(cur.gross, r.gross),
        });
      }
    }
    for (const [rate, r] of rows) if ([r.net, r.vat, r.gross].every((v) => v === '0.00')) rows.delete(rate);
    return { rows, gross: moneyDifference(invoice.total, moneySum(corrections.map((c) => c.total))) };
  }

  /** What the order's payment still holds: its total less every refund the settlements recorded. */
  async function leftPaid(orderId: string, total: string): Promise<string> {
    return withSystemScope('test: read the refunds', async () => {
      const em = h.em().fork();
      const cases = await em.find(ReturnCase, { orderId });
      const refunds = cases.length > 0 ? await em.find(Refund, { returnCaseId: { $in: cases.map((c) => c.id) } }) : [];
      return moneyDifference(total, moneySum(refunds.map((r) => r.amount)));
    });
  }

  const correctionLines = async (invoiceId: string) =>
    h.em().fork().find(InvoiceLine, { invoiceId }, { orderBy: { ordinal: 'asc' } });

  describe('the same returns, invoiced before and after, end on the same figures (#873)', () => {
    const scenarios = [
      {
        name: '3 × 10.01 at 23 %, one unit then one more',
        seed: seedBolts,
        cases: (items: string[]) => [[{ orderItemId: items[0]!, quantity: 1 }], [{ orderItemId: items[0]!, quantity: 1 }]],
      },
      {
        name: 'two rates with a discount, delivery and a surcharge: 1A + 1B, then 1A',
        seed: seedTwoRate,
        cases: (items: string[]) => [
          [
            { orderItemId: items[0]!, quantity: 1 },
            { orderItemId: items[1]!, quantity: 1 },
          ],
          [{ orderItemId: items[0]!, quantity: 1 }],
        ],
      },
    ];
    for (const s of scenarios) {
      it(s.name, async () => {
        // X: invoiced, then returned — the corrections take the goods off.
        const x = await s.seed();
        await issueInvoice(x.orderId);
        const cases = s.cases(x.items);
        for (const [k, lines] of cases.entries()) {
          await settleCase(x.orderId, lines);
          // Y: the same first k + 1 returns, then invoiced — the invoice lists the kept lines.
          const y = await s.seed();
          for (const earlier of s.cases(y.items).slice(0, k + 1)) await settleCase(y.orderId, earlier);
          const yInvoice = await issueInvoice(y.orderId);

          const xKept = await keptRows(x.orderId);
          expect(xKept.rows, `after case ${k + 1}`).toEqual(rowsOf(yInvoice));
          expect(xKept.gross).toBe(roundHalfUp(yInvoice.total));
          expect(await leftPaid(x.orderId, x.total)).toBe(xKept.gross);
          expect(await leftPaid(y.orderId, y.total)).toBe(roundHalfUp(yInvoice.total));
        }
      });
    }

    it('3 × 10.01, one unit back: the correction credits 10.01 net and 2.31 VAT and the invoice keeps 20.02 / 4.60', async () => {
      const x = await seedBolts();
      await issueInvoice(x.orderId);
      const { correctiveInvoiceId } = await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }]);
      const correction = await h.em().fork().findOneOrFail(Invoice, { id: correctiveInvoiceId! });
      expect([correction.total, correction.netTotal, correction.taxTotal]).toEqual(['12.32', '10.01', '2.31']);
      expect((await keptRows(x.orderId)).rows).toEqual(new Map([['0.2300', { net: '20.02', vat: '4.60', gross: '24.62' }]]));
    });
  });

  describe('a complaint refunded after invoicing is a price reduction (#885)', () => {
    it('AC-885-1 — 6.15 on 1 of 3 × 10.01: 5.00 / 1.15 on a quantity-0 line under the label, no discount', async () => {
      const x = await seedBolts();
      await issueInvoice(x.orderId);
      const { caseId, rmaNumber, correctiveInvoiceId } = await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }], {
        kind: 'complaint',
        amounts: [6.15],
      });
      expect(correctiveInvoiceId).not.toBeNull();
      const correction = await h.em().fork().findOneOrFail(Invoice, { id: correctiveInvoiceId! });
      expect(correction.vatSummary).toEqual([{ taxRate: '0.2300', netTotal: '5.00', vatAmount: '1.15', grossTotal: '6.15' }]);
      const lines = await correctionLines(correction.id);
      expect(lines.map((l) => [l.name, l.quantity, l.unitNetPrice, l.taxRate, l.netValue, l.grossValue])).toEqual([
        // Named in the invoice's language (owner answer N5).
        [`Obniżka ceny (reklamacja ${rmaNumber}): Bolt`, '0.000', '1.6667', '0.2300', '5.00', '6.15'],
      ]);
      const refund = await withSystemScope('test: read the refund', () => h.em().fork().findOneOrFail(Refund, { returnCaseId: caseId }));
      expect([refund.correctiveInvoiceOutcome, refund.correctiveInvoiceId]).toEqual(['issued', correction.id]);
      // The invoice keeps 25.03 / 5.76 / 30.79 — what is left paid.
      const kept = await keptRows(x.orderId);
      expect(kept.rows).toEqual(new Map([['0.2300', { net: '25.03', vat: '5.76', gross: '30.79' }]]));
      expect(await leftPaid(x.orderId, x.total)).toBe('30.79');
    });

    it('AC-885-2 — then a return of 1 unit: the kept quantity goes 3 → 2 and the money stays exact', async () => {
      const x = await seedBolts();
      const invoice = await issueInvoice(x.orderId);
      await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }], { kind: 'complaint', amounts: [6.15] });
      const { correctiveInvoiceId } = await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }]);
      const em = h.em().fork();
      const corrections = await em.find(Invoice, { originalInvoiceId: invoice.id, kind: 'correction' });
      const credited = await em.find(InvoiceLine, { invoiceId: { $in: corrections.map((c) => c.id) }, orderItemId: x.items[0]! });
      // The complaint's line credits no quantity; the return's credits 1.
      expect(credited.map((l) => [l.invoiceId === correctiveInvoiceId, l.quantity]).sort()).toEqual([
        [false, '0.000'],
        [true, '1.000'],
      ]);
      const kept = await keptRows(x.orderId);
      expect(kept.gross).toBe(await leftPaid(x.orderId, x.total));
      expect(compareDecimals(moneySum(corrections.map((c) => c.total)), invoice.total)).toBeLessThanOrEqual(0);
    });

    it('AC-885-3 — on a discounted order the complaint credits no discount, and the invoice’s discount line is untouched', async () => {
      const x = await seedTwoRate();
      await issueInvoice(x.orderId);
      const { correctiveInvoiceId } = await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }], {
        kind: 'complaint',
        amounts: [6.15],
      });
      const lines = await correctionLines(correctiveInvoiceId!);
      expect(lines.map((l) => [l.quantity, l.taxRate, l.netValue, l.grossValue])).toEqual([['0.000', '0.2300', '5.00', '6.15']]);
      const kept = await keptRows(x.orderId);
      // 0 %: 10.00 delivery + 2.50 surcharge − 5.00 discount, as invoiced.
      expect(kept.rows.get('0.0000')).toEqual({ net: '7.50', vat: '0.00', gross: '7.50' });
      expect(kept.rows.get('0.2300')).toEqual({ net: '25.03', vat: '5.76', gross: '30.79' });
      expect(kept.gross).toBe(await leftPaid(x.orderId, x.total));
    });

    it('AC-885-5 — a complaint resolved by replacement or repair issues no correction', async () => {
      const x = await seedBolts();
      const invoice = await issueInvoice(x.orderId);
      await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }], { kind: 'complaint', resolutionType: 'replacement' });
      await settleCase(x.orderId, [{ orderItemId: x.items[0]!, quantity: 1 }], { kind: 'complaint', resolutionType: 'repair' });
      expect(await h.em().fork().find(Invoice, { originalInvoiceId: invoice.id, kind: 'correction' })).toHaveLength(0);
    });
  });
});
