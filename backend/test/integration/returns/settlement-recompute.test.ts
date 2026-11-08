import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moneyDifference, moneySum, roundHalfUp } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { CreditLimit, Invoice, Order, OrderItem, Refund, ReturnCase, ReturnCaseItem } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { setSellerSettings } from '../invoices/helpers.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph } from './helpers.js';

let CH: string;

/**
 * Issues #874 and #875 — the default refund is recomputed at settlement, under
 * the order's lock, from the cases already settled; the kept state is what
 * settled `return` cases gave back for money. A case settled out of creation
 * order, or after an earlier case was rejected, therefore refunds what leaves
 * the kept goods' invoice equal to what is left paid, and a complaint — a
 * price reduction of goods the buyer keeps (#885) — counts against what is
 * left paid and against the line it names, never in the kept state. No line
 * refunds more than it was paid (the per-line ceiling of the #885 amendment,
 * §4); the operator lowers a return after a complaint by hand (E-C).
 */
describe('returns — the default refund recomputed at settlement (#874, #875)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'ret-recompute');
    await resetReturnGraph(h.em());
    await setSellerSettings(h);
    for (const [key, pattern] of [
      ['invoices.numbering.invoice.pattern', 'FVRC {seq}/{YYYY}'],
      ['invoices.numbering.correction.pattern', 'KORRC {seq}/{YYYY}'],
    ] as const) {
      await h.settings.adminService.setValueForSubset(key, ['ret-recompute'], pattern, null, {
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
    lineTotal: string;
  }

  /** A completed, paid per-rate order, the way `OrderService.placeOrder` writes one. */
  async function seedOrder(
    lines: SeedLine[],
    totals: { subtotal: string; taxTotal: string; discount?: string },
  ): Promise<{ orderId: string; items: string[]; total: string }> {
    const em = h.em().fork();
    const discount = totals.discount ?? '0.00';
    const total = moneyDifference(moneySum([totals.subtotal, totals.taxTotal]), discount);
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
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'Przelew', kind: 'bank_transfer' },
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      deliveryTotal: '0.00',
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
        productSnapshot: { sku: `RC-${position}`, name: l.name, primaryAssetUrl: null },
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
  /** 3 × 10.01 at 23 %: 36.94 paid. */
  const seedBolts = () => seedOrder([BOLT], { subtotal: '30.03', taxTotal: '6.91' });
  /** Two rates and a 5.00 order discount: 42.73 paid for the goods. */
  const seedTwoRate = () => seedOrder([BOLT, WASHER], { subtotal: '40.02', taxTotal: '7.71', discount: '5.00' });

  interface OpenCase {
    id: string;
    items: Array<{ id: string; defaultRefundAmount: number }>;
  }

  /** Submit a case; with `received`, authorize it and receive it so it can settle. */
  async function openCase(
    orderId: string,
    lines: Array<{ orderItemId: string; quantity: number }>,
    kind: 'return' | 'complaint' = 'return',
  ): Promise<OpenCase> {
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind, lines: lines.map((l) => ({ ...l, reasonId })) },
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { data: OpenCase }).data;
  }

  async function receive(c: OpenCase): Promise<void> {
    const authorized = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${c.id}/authorize`, cookies: ADMIN_COOKIE });
    expect(authorized.statusCode, authorized.body).toBe(200);
    const received = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${c.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    expect(received.statusCode, received.body).toBe(200);
  }

  async function reject(c: OpenCase): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${c.id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'Not eligible' },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** Settle with each line approved at `amounts[i]`, or at the default the case was created with. */
  function settle(
    c: OpenCase,
    opts: { amounts?: number[]; resolutionType?: 'refund' | 'credit' | 'replacement' | 'repair' } = {},
  ) {
    const resolutionType = opts.resolutionType ?? 'refund';
    const movesMoney = resolutionType === 'refund' || resolutionType === 'credit';
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${c.id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType,
        lines: c.items.map((it, i) => ({
          returnCaseItemId: it.id,
          approvedRefundAmount: movesMoney ? (opts.amounts?.[i] ?? it.defaultRefundAmount) : 0,
        })),
        ...(resolutionType === 'refund' ? { refundPaymentMethodId: randomUUID() } : {}),
      },
    });
  }

  async function settled(c: OpenCase, opts: Parameters<typeof settle>[1] = {}): Promise<void> {
    const res = await settle(c, opts);
    expect(res.statusCode, res.body).toBe(200);
  }

  async function prefill(c: OpenCase): Promise<Array<{ defaultRefundAmount: number; approvedRefundAmount: number }>> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${c.id}/settlement`, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { items: Array<{ defaultRefundAmount: number; approvedRefundAmount: number }> } }).data.items;
  }

  /** The stored default, discount and approved amount of each line, in the order the case was created with. */
  async function stored(c: OpenCase): Promise<Array<[string, string, string]>> {
    const em = h.em().fork();
    const rows = await em.find(ReturnCaseItem, { returnCaseId: c.id });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return c.items.map((it) => {
      const r = byId.get(it.id)!;
      return [roundHalfUp(r.defaultRefundAmount), roundHalfUp(r.defaultDiscountAmount), roundHalfUp(r.approvedRefundAmount)];
    });
  }

  const refundOf = async (c: OpenCase): Promise<string> =>
    withSystemScope('test: read the refund', async () =>
      roundHalfUp((await h.em().fork().findOneOrFail(Refund, { returnCaseId: c.id })).amount),
    );

  const settledAudit = async (c: OpenCase): Promise<Record<string, unknown>> => {
    const entry = await h.em().fork().findOneOrFail(AuditLogEntry, { action: 'return.settled', objectId: c.id });
    return entry.stateAfter as Record<string, unknown>;
  };

  async function leftPaid(orderId: string, total: string): Promise<string> {
    return withSystemScope('test: read the refunds', async () => {
      const em = h.em().fork();
      const cases = await em.find(ReturnCase, { orderId });
      const refunds = await em.find(Refund, { returnCaseId: { $in: cases.map((c) => c.id) } });
      return moneyDifference(total, moneySum(refunds.map((r) => r.amount)));
    });
  }

  async function issueInvoice(orderId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  /** The invoice's gross less every correction issued against it. */
  async function keptGross(orderId: string): Promise<string> {
    const em = h.em().fork();
    const invoice = await em.findOneOrFail(Invoice, { orderId, kind: 'invoice' });
    const corrections = await em.find(Invoice, { originalInvoiceId: invoice.id, kind: 'correction' });
    return moneyDifference(invoice.total, moneySum(corrections.map((c) => c.total)));
  }

  describe('settled out of creation order, or after a rejection (#875)', () => {
    it('3 × 10.01, two 1-unit cases, the second settled first: 12.32 then 12.31, recomputed and audited', async () => {
      const o = await seedBolts();
      const c1 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      // Shown at creation, on the live basis.
      expect([c1.items[0]!.defaultRefundAmount, c2.items[0]!.defaultRefundAmount]).toEqual([12.32, 12.31]);
      await receive(c1);
      await receive(c2);

      // The prefill previews the default on the settled basis.
      expect(await prefill(c2)).toEqual([expect.objectContaining({ defaultRefundAmount: 12.32, approvedRefundAmount: 12.32 })]);
      // Approved at the 12.31 the form showed before: the default approved, settled at 12.32.
      await settled(c2);
      expect(await stored(c2)).toEqual([['12.32', '0.00', '12.32']]);
      expect(await refundOf(c2)).toBe('12.32');
      expect((await settledAudit(c2)).recomputedDefaults).toEqual([{ itemId: c2.items[0]!.id, from: '12.31', to: '12.32' }]);

      expect(await prefill(c1)).toEqual([expect.objectContaining({ defaultRefundAmount: 12.31, approvedRefundAmount: 12.31 })]);
      await settled(c1);
      expect(await stored(c1)).toEqual([['12.31', '0.00', '12.31']]);
      expect((await settledAudit(c1)).recomputedDefaults).toEqual([{ itemId: c1.items[0]!.id, from: '12.32', to: '12.31' }]);
      // The one unit kept is 10.01 + 2.30.
      expect(await leftPaid(o.orderId, o.total)).toBe('12.31');
    });

    it('3 × 10.01, the first case rejected: the second settles at 12.32, not 12.31 (left paid 24.62, the kept invoice)', async () => {
      const o = await seedBolts();
      const c1 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await reject(c1);
      await receive(c2);
      await settled(c2);
      expect(await refundOf(c2)).toBe('12.32');
      expect(await leftPaid(o.orderId, o.total)).toBe('24.62');
    });

    it('two rates with a discount, 1A + 1B then 1A, the second settled first: 11.03 / 1.29, then 11.02 / 1.29 + 4.83 / 0.56', async () => {
      const o = await seedTwoRate();
      const c1 = await openCase(o.orderId, [
        { orderItemId: o.items[0]!, quantity: 1 },
        { orderItemId: o.items[1]!, quantity: 1 },
      ]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      expect(c2.items[0]!.defaultRefundAmount).toBe(11.02);
      await receive(c1);
      await receive(c2);
      await settled(c2);
      expect(await stored(c2)).toEqual([['11.03', '1.29', '11.03']]);
      await settled(c1);
      expect(await stored(c1)).toEqual([
        ['11.02', '1.29', '11.02'],
        ['4.83', '0.56', '4.83'],
      ]);
      // Kept: 1A (12.31) + 1B (5.40) less the 1.86 of discount they carry.
      expect(await leftPaid(o.orderId, o.total)).toBe('15.85');
    });

    it('two rates with a discount, the first case rejected: the second settles at 11.03 (left paid 31.70)', async () => {
      const o = await seedTwoRate();
      const c1 = await openCase(o.orderId, [
        { orderItemId: o.items[0]!, quantity: 1 },
        { orderItemId: o.items[1]!, quantity: 1 },
      ]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await reject(c1);
      await receive(c2);
      await settled(c2);
      expect(await refundOf(c2)).toBe('11.03');
      expect(await leftPaid(o.orderId, o.total)).toBe('31.70');
    });

    it('settled in creation order, nothing moves and nothing is recorded as recomputed', async () => {
      const o = await seedBolts();
      const c1 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(c1);
      await receive(c2);
      await settled(c1);
      await settled(c2);
      expect([await refundOf(c1), await refundOf(c2)]).toEqual(['12.32', '12.31']);
      expect((await settledAudit(c1)).recomputedDefaults).toBeUndefined();
      expect((await settledAudit(c2)).recomputedDefaults).toBeUndefined();
    });

    it('an amount the operator lowered is kept as typed, while the default is recomputed', async () => {
      const o = await seedBolts();
      await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      const c2 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(c2);
      await settled(c2, { amounts: [10] });
      expect(await stored(c2)).toEqual([['12.32', '0.00', '10.00']]);
      expect(await refundOf(c2)).toBe('10.00');
    });

    it('refuses an amount above the default with nothing written', async () => {
      const o = await seedBolts();
      const c1 = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(c1);
      const res = await settle(c1, { amounts: [12.33] });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as { error: { details?: { code?: string } } }).error.details?.code).toBe('refund_exceeds_paid');
      expect(await stored(c1)).toEqual([['12.32', '0.00', '12.32']]);
      const refunds = await withSystemScope('test: read the refunds', () => h.em().fork().find(Refund, { returnCaseId: c1.id }));
      expect(refunds).toHaveLength(0);
    });
  });

  describe('complaints are outside the kept state (#874)', () => {
    it('a complaint for 1 unit settled as a replacement, then a return of 1 unit: 12.32', async () => {
      const o = await seedBolts();
      const complaint = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }], 'complaint');
      await receive(complaint);
      await settled(complaint, { resolutionType: 'replacement' });
      const ret = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      expect(ret.items[0]!.defaultRefundAmount).toBe(12.32);
      await receive(ret);
      await settled(ret);
      expect(await refundOf(ret)).toBe('12.32');
      expect(await leftPaid(o.orderId, o.total)).toBe('24.62');
    });

    it('a return-kind case resolved as a replacement, then a return of 1 unit: 12.32', async () => {
      const o = await seedBolts();
      const replaced = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(replaced);
      await settled(replaced, { resolutionType: 'replacement' });
      const ret = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      expect(ret.items[0]!.defaultRefundAmount).toBe(12.32);
      await receive(ret);
      await settled(ret);
      expect(await refundOf(ret)).toBe('12.32');
    });

    it('a complaint refunded 12.32, then a return of 1 unit: 12.32, and what was paid still bounds them', async () => {
      const o = await seedBolts();
      const complaint = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }], 'complaint');
      await receive(complaint);
      await settled(complaint, { amounts: [12.32] });
      const ret = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(ret);
      await settled(ret);
      expect(await refundOf(ret)).toBe('12.32');
      expect(await leftPaid(o.orderId, o.total)).toBe('12.30');
    });
  });

  describe('the per-line ceiling (#885 amendment §4, AC-885-7, E-C)', () => {
    it('a complaint of 11.03 on 1A, then 2A: the ceiling takes 22.05 to 22.04, audited; 2B closes the order at 0', async () => {
      const o = await seedTwoRate();
      await issueInvoice(o.orderId);
      const complaint = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }], 'complaint');
      expect(complaint.items[0]!.defaultRefundAmount).toBe(11.03);
      await receive(complaint);
      await settled(complaint);
      expect(await refundOf(complaint)).toBe('11.03');

      const a = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 2 }]);
      await receive(a);
      // The form offers at most what line A has left: 33.07 − 11.03.
      expect(await prefill(a)).toEqual([expect.objectContaining({ defaultRefundAmount: 22.04, approvedRefundAmount: 22.04 })]);
      await settled(a);
      // The stored default stays the goods' value; the refund is the effective default, carrying the full discount.
      expect(await stored(a)).toEqual([['22.05', '2.58', '22.04']]);
      expect(await refundOf(a)).toBe('22.04');
      expect((await settledAudit(a)).lineCeilings).toEqual([{ itemId: a.items[0]!.id, default: '22.05', ceiling: '22.04' }]);

      const b = await openCase(o.orderId, [{ orderItemId: o.items[1]!, quantity: 2 }]);
      await receive(b);
      await settled(b);
      expect(await refundOf(b)).toBe('9.66');
      expect(await leftPaid(o.orderId, o.total)).toBe('0.00');
      // Every correction went through, and the invoice keeps what is left paid.
      expect(await keptGross(o.orderId)).toBe('0.00');
    });

    it('E-C — a complaint of 6.15 on 1A, then 1A returned: the form offers the full 11.03; 4.88 is accepted and the money is exact', async () => {
      const o = await seedTwoRate();
      await issueInvoice(o.orderId);
      const complaint = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }], 'complaint');
      await receive(complaint);
      await settled(complaint, { amounts: [6.15] });
      const ret = await openCase(o.orderId, [{ orderItemId: o.items[0]!, quantity: 1 }]);
      await receive(ret);
      expect(await prefill(ret)).toEqual([expect.objectContaining({ defaultRefundAmount: 11.03, approvedRefundAmount: 11.03 })]);
      await settled(ret, { amounts: [4.88] });
      expect(await refundOf(ret)).toBe('4.88');
      expect(await stored(ret)).toEqual([['11.03', '1.29', '4.88']]);
      expect((await settledAudit(ret)).lineCeilings).toBeUndefined();
      const left = await leftPaid(o.orderId, o.total);
      expect(left).toBe(moneyDifference(o.total, moneySum(['6.15', '4.88'])));
      expect(await keptGross(o.orderId)).toBe(left);
    });
  });
});
