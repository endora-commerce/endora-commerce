import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { Invoice, Order, OrderItem, Payment, Refund, ReturnCase } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, setSellerSettings } from './helpers.js';
import { withModuleOff } from '../../helpers/off-state.js';

interface IssueResponse {
  data: {
    id: string;
    netTotal: number;
    taxTotal: number;
    grossTotal: number;
    paidTotal: number;
    amountDue: number;
    overpayment: number;
    lines: Array<{ name: string; quantity: number; unitNetPrice: number; netValue: number; grossValue: number }>;
    vatSummary: Array<{ taxRate: number; netTotal: number; vatAmount: number; grossTotal: number }>;
  };
}

/**
 * Seed an order the way `OrderService.placeOrder` writes one: `lineTotal` is
 * the line's **gross** (`unitPrice × quantity × (1 + taxRate)`, half-up), and
 * the order's tax is the sum of the lines' exact taxes, rounded once.
 */
async function seedPlacedOrder(
  em: EntityManager,
  salesChannelId: string,
  lines: Array<{ unitPrice: string; quantity: number; taxRate: string; lineTotal: string }>,
  totals: { subtotal: string; taxTotal: string; total: string },
  payment: { paymentStatus?: 'paid' | 'deferred' | 'refunded' | undefined; kind?: 'bank_transfer' | 'credit_limit' | 'gateway' | undefined } = {},
): Promise<string> {
  const order = em.create(Order, {
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    salesChannelId,
    status: 'paid',
    paymentStatus: payment.paymentStatus ?? 'paid',
    deliveryAddress: { recipientName: 'Example Buyer', street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-002', country: 'PL' },
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
    deliveryMethodSnapshot: { code: 'dm', name: 'Kurier', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'pm', name: 'Przelew', kind: payment.kind ?? 'bank_transfer' },
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    deliveryTotal: '0.00',
    discountTotal: '0.00',
    total: totals.total,
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persist(order).flush();
  await em.persist(
    lines.map((l, i) =>
      em.create(OrderItem, {
        orderId: order.id,
        productId: randomUUID(),
        productSnapshot: { sku: `DEC-${i}`, name: `Line ${i + 1}`, primaryAssetUrl: null },
        quantity: l.quantity,
        position: i,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        lineTotal: l.lineTotal,
      }),
    ),
  ).flush();
  return order.id;
}

let CH: string;

describe('invoices — exact decimal amounts (#417)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-decimal');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-decimal'],
      'FVDEC {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('invoices a line at its net (unit price × quantity), not at the order line gross', async () => {
    // 100.00 net at 23 %: the order line's `lineTotal` is the gross 123.00.
    const orderId = await seedPlacedOrder(
      h.em(),
      CH,
      [{ unitPrice: '50.00', quantity: 2, taxRate: '0.2300', lineTotal: '123.00' }],
      { subtotal: '100.00', taxTotal: '23.00', total: '123.00' },
    );
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json() as IssueResponse;
    expect(data.lines[0]).toMatchObject({ quantity: 2, unitNetPrice: 50, netValue: 100, grossValue: 123 });
    expect([data.netTotal, data.taxTotal, data.grossTotal]).toEqual([100, 23, 123]);
  });

  it('rounds each line gross half-up on the exact decimal product (G1 at 23 %, G2 at 5 %)', async () => {
    const orderId = await seedPlacedOrder(
      h.em(),
      CH,
      [
        { unitPrice: '29.50', quantity: 1, taxRate: '0.2300', lineTotal: '36.29' },
        { unitPrice: '4.30', quantity: 1, taxRate: '0.0500', lineTotal: '4.52' },
      ],
      { subtotal: '33.80', taxTotal: '7.01', total: '40.81' },
    );
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json() as IssueResponse;
    // Seeded in one flush, the two lines tie on every ordering key: compare them as a set.
    expect(data.lines.map((l) => [l.netValue, l.grossValue]).sort((x, y) => y[0]! - x[0]!)).toEqual([
      [29.5, 36.29],
      [4.3, 4.52],
    ]);
    expect(data.vatSummary).toEqual([
      { taxRate: 0.05, netTotal: 4.3, vatAmount: 0.22, grossTotal: 4.52 },
      { taxRate: 0.23, netTotal: 29.5, vatAmount: 6.79, grossTotal: 36.29 },
    ]);
    // VAT per rate on the sum of the nets (owner ruling of 2026-10-24): 6.79 + 0.22.
    // The order computes the same 7.01 and 40.81 — vector V2 of
    // `specs/pricing/worked-examples.md` §10.17.
    expect([data.netTotal, data.taxTotal, data.grossTotal]).toEqual([33.8, 7.01, 40.81]);
  });

  it('records as paid what was captured, not the invoice gross, for an order placed before 0.108.0', async () => {
    // Placed before the per-rate method: the order summed the lines' exact taxes
    // and rounded once (7.00, total 40.80), and 40.80 was captured. Its invoice,
    // issued now, takes VAT per rate (7.01, gross 40.81): 0.01 is still due.
    const orderId = await seedPlacedOrder(
      h.em(),
      CH,
      [
        { unitPrice: '29.50', quantity: 1, taxRate: '0.2300', lineTotal: '36.29' },
        { unitPrice: '4.30', quantity: 1, taxRate: '0.0500', lineTotal: '4.52' },
      ],
      { subtotal: '33.80', taxTotal: '7.00', total: '40.80' },
    );
    const em = h.em().fork();
    em.create(Payment, {
      orderId,
      paymentMethodId: randomUUID(),
      status: 'paid',
      amount: '40.80',
      currency: 'PLN',
      paidAt: new Date(),
    });
    await em.flush();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { data } = res.json() as IssueResponse;
    expect([data.grossTotal, data.paidTotal, data.amountDue]).toEqual([40.81, 40.8, 0.01]);
  });

  // Review of PR #423 — paid is what was captured minus what was refunded, each attempt once.
  async function issueAfterPayments(payments: Array<{ status: string; amount: string; refundedAmount?: string }>) {
    const orderId = await seedPlacedOrder(
      h.em(),
      CH,
      [{ unitPrice: '33.17', quantity: 1, taxRate: '0.2300', lineTotal: '40.80' }],
      { subtotal: '33.17', taxTotal: '7.63', total: '40.80' },
    );
    const em = h.em().fork();
    for (const p of payments) {
      em.create(Payment, {
        orderId,
        paymentMethodId: randomUUID(),
        status: p.status,
        amount: p.amount,
        refundedAmount: p.refundedAmount ?? '0',
        currency: 'PLN',
        paidAt: new Date(),
      } as never);
    }
    await em.flush();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    return { res, orderId };
  }
  async function invoicedPaid(payments: Array<{ status: string; amount: string; refundedAmount?: string }>) {
    const { res } = await issueAfterPayments(payments);
    expect(res.statusCode, res.body).toBe(201);
    const { data } = res.json() as IssueResponse;
    return [data.grossTotal, data.paidTotal, data.amountDue];
  }

  it('records as paid what was kept after a refund made before invoicing', async () => {
    expect(await invoicedPaid([{ status: 'partially_refunded', amount: '40.80', refundedAmount: '10.00' }])).toEqual([
      40.8, 30.8, 10,
    ]);
  });

  it('counts each of two paid attempts once', async () => {
    expect(
      await invoicedPaid([
        { status: 'paid', amount: '20.00' },
        { status: 'paid', amount: '20.80' },
        { status: 'failed', amount: '40.80' },
      ]),
    ).toEqual([40.8, 40.8, 0]);
  });

  // Issue #428 point 2 — paid above the gross: nothing is due, and the excess
  // is an explicit overpayment rather than a negative amount due.
  it('clamps the amount due at 0 and states the overpayment', async () => {
    const { res } = await issueAfterPayments([{ status: 'paid', amount: '50.00' }]);
    expect(res.statusCode, res.body).toBe(201);
    const { data } = res.json() as IssueResponse;
    expect([data.grossTotal, data.paidTotal, data.amountDue, data.overpayment]).toEqual([40.8, 50, 0, 9.2]);
  });

  it('states no overpayment while something is still due', async () => {
    const { res } = await issueAfterPayments([{ status: 'partially_refunded', amount: '40.80', refundedAmount: '10.00' }]);
    const { data } = res.json() as IssueResponse;
    expect([data.amountDue, data.overpayment]).toEqual([10, 0]);
  });

  // Owner ruling of 2026-10-24 — an order refunded in full before it is
  // invoiced has no sale left to document, so it is not invoiced.
  it('refuses to invoice an order refunded in full before invoicing', async () => {
    const { res, orderId } = await issueAfterPayments([
      { status: 'refunded', amount: '40.80', refundedAmount: '40.80' },
    ]);
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_ORDER_REFUNDED);
    expect(body.error.message).toBeTruthy();
    const issued = await h.em().fork().find(Invoice, { orderId, kind: 'invoice' });
    expect(issued, 'nothing issued, no number drawn').toHaveLength(0);
  });

  it('refuses it as well when the full refund came from two attempts', async () => {
    const { res } = await issueAfterPayments([
      { status: 'refunded', amount: '20.00', refundedAmount: '20.00' },
      { status: 'refunded', amount: '20.80', refundedAmount: '20.80' },
    ]);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.INVOICE_ORDER_REFUNDED);
  });

  it('still invoices an order whose refunds do not cover it, recording nothing as paid', async () => {
    // 20.00 captured of 40.80 and refunded: nothing kept, but the refunds are not the whole order.
    expect(await invoicedPaid([{ status: 'refunded', amount: '20.00', refundedAmount: '20.00' }])).toEqual([
      40.8, 0, 40.8,
    ]);
  });

  // Issue #428 point 1 — a refund made outside `payments` (the settlement of a
  // return refunded by bank transfer, or credited to the credit limit) is part
  // of what was refunded, exactly once.
  async function issueWithReturnRefunds(
    options: {
      paymentStatus?: 'paid' | 'deferred' | 'refunded';
      kind?: 'bank_transfer' | 'credit_limit' | 'gateway';
      payments?: Array<{ status: string; amount: string; refundedAmount?: string }>;
      refunds: Array<{ resolutionType: 'refund' | 'credit'; amount: string; settlementState?: 'issued' | 'pending_manual' }>;
    },
  ) {
    const orderId = await seedPlacedOrder(
      h.em(),
      CH,
      [{ unitPrice: '33.17', quantity: 1, taxRate: '0.2300', lineTotal: '40.80' }],
      { subtotal: '33.17', taxTotal: '7.63', total: '40.80' },
      { paymentStatus: options.paymentStatus, kind: options.kind },
    );
    const em = h.em().fork();
    for (const p of options.payments ?? []) {
      em.create(Payment, {
        orderId,
        paymentMethodId: randomUUID(),
        status: p.status,
        amount: p.amount,
        refundedAmount: p.refundedAmount ?? '0',
        currency: 'PLN',
        paidAt: new Date(),
      } as never);
    }
    for (const r of options.refunds) {
      const rc = em.create(ReturnCase, {
        kind: 'return',
        orderId,
        salesChannelId: CH,
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        statusCode: 'resolved',
        currency: 'PLN',
        submittedAt: new Date(),
      } as never);
      em.create(Refund, {
        returnCaseId: (rc as { id: string }).id,
        resolutionType: r.resolutionType,
        amount: r.amount,
        currency: 'PLN',
        settlementState: r.settlementState ?? 'issued',
      } as never);
    }
    await em.flush();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    return res;
  }
  async function paidAfterReturns(options: Parameters<typeof issueWithReturnRefunds>[0]) {
    const res = await issueWithReturnRefunds(options);
    expect(res.statusCode, res.body).toBe(201);
    const { data } = res.json() as IssueResponse;
    return [data.grossTotal, data.paidTotal, data.amountDue];
  }

  it('deducts a manual bank-transfer refund of a return settled before invoicing', async () => {
    expect(await paidAfterReturns({ refunds: [{ resolutionType: 'refund', amount: '15.00' }] })).toEqual([
      40.8, 25.8, 15,
    ]);
  });

  it('deducts a credit-limit top-up of a return settled before invoicing', async () => {
    expect(
      await paidAfterReturns({
        kind: 'gateway',
        payments: [{ status: 'paid', amount: '40.80' }],
        refunds: [{ resolutionType: 'credit', amount: '10.00' }],
      }),
    ).toEqual([40.8, 30.8, 10]);
  });

  it('counts a gateway refund once although the return and the payment both record it', async () => {
    expect(
      await paidAfterReturns({
        kind: 'gateway',
        payments: [{ status: 'partially_refunded', amount: '40.80', refundedAmount: '10.00' }],
        refunds: [{ resolutionType: 'refund', amount: '10.00' }],
      }),
    ).toEqual([40.8, 30.8, 10]);
  });

  it('does not deduct a refund still waiting for a person', async () => {
    expect(
      await paidAfterReturns({ refunds: [{ resolutionType: 'refund', amount: '15.00', settlementState: 'pending_manual' }] }),
    ).toEqual([40.8, 40.8, 0]);
  });

  it('degrades without returns: issues the invoice and deducts only what payments recorded', async () => {
    const res = await withModuleOff('returns', 'deactivated', () =>
      issueWithReturnRefunds({ refunds: [{ resolutionType: 'refund', amount: '15.00' }] }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const { data } = res.json() as IssueResponse;
    expect([data.grossTotal, data.paidTotal, data.amountDue]).toEqual([40.8, 40.8, 0]);
  });

  it('refuses to invoice an order refunded in full by manual refunds', async () => {
    const res = await issueWithReturnRefunds({
      refunds: [
        { resolutionType: 'refund', amount: '30.00' },
        { resolutionType: 'refund', amount: '10.80' },
      ],
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.INVOICE_ORDER_REFUNDED);
  });

  it('refuses to invoice an order an operator marked refunded with nothing captured', async () => {
    const res = await issueWithReturnRefunds({ paymentStatus: 'refunded', refunds: [] });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.INVOICE_ORDER_REFUNDED);
  });

  // Owner ruling on PR #434 — a captured order an operator marked refunded by
  // hand (e.g. the manual settlement after a refund anomaly) is refunded in full.
  it('refuses to invoice a captured order an operator marked refunded by hand', async () => {
    const res = await issueWithReturnRefunds({
      paymentStatus: 'refunded',
      kind: 'gateway',
      payments: [{ status: 'paid', amount: '40.80' }],
      refunds: [],
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.INVOICE_ORDER_REFUNDED);
  });

  // Issue #428 point 6 — on credit terms the on-account part is unpaid by
  // arrangement at invoicing. A captured part refunded in full leaves nothing
  // paid, and the refunds do not cover the order, so it is invoiced, paid 0.
  it('invoices an on-account order whose captured part was refunded in full, with nothing paid', async () => {
    expect(
      await paidAfterReturns({
        paymentStatus: 'deferred',
        kind: 'credit_limit',
        payments: [{ status: 'refunded', amount: '15.00', refundedAmount: '15.00' }],
        refunds: [],
      }),
    ).toEqual([40.8, 0, 40.8]);
  });
});

