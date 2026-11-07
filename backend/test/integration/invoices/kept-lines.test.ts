import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreditLimit, Order, OrderItem, Refund, ReturnCase, ReturnCaseItem } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN_COOKIE, setSellerSettings } from './helpers.js';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph } from '../returns/helpers.js';

interface IssuedInvoice {
  grossTotal: number;
  paidTotal: number;
  amountDue: number;
  overpayment: number;
  lines: Array<{ name: string; quantity: number; unitNetPrice: number; netValue: number; grossValue: number }>;
  vatSummary: Array<{ taxRate: number; netTotal: number; vatAmount: number; grossTotal: number }>;
}

let CH: string;

/**
 * Issue #435 — an invoice issued after a return was settled, but before any
 * invoice existed, lists only the lines the buyer kept (product-owner ruling of
 * 2026-11-07). There is no invoice to correct at that point (#135), so the
 * invoice itself documents the sale that is left: for each order line, the
 * quantity of settled `return`-kind cases resolved with a refund or a credit is
 * taken off, whether or not the money has been paid out. A replacement or a
 * repair changes nothing, and with `returns` switched off nothing can say what
 * came back, so every line is invoiced as before.
 */
describe('invoices — an invoice issued after a return lists the kept lines (#435)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-kept');
    await resetReturnGraph(h.em());
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-kept'],
      'FVKEPT {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
    // The credit resolution tops up the organization's grant; without one it
    // stays `pending_manual`.
    const em = h.em().fork();
    if (!(await em.findOne(CreditLimit, { organizationId: TEST_ORGANIZATION_ID }))) {
      em.create(CreditLimit, { organizationId: TEST_ORGANIZATION_ID, grantedAmount: '500.00', currency: 'PLN' });
      await em.flush();
    }
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * A completed, paid order placed under the per-rate VAT method, the way
   * `OrderService.placeOrder` writes one. Two lines at 23 %: 3 × 10.00 (gross
   * 36.90) and 1 × 20.00 (gross 24.60); 50.00 net, 11.50 VAT, 61.50 total.
   */
  async function seedOrder(): Promise<{ orderId: string; widget: string; gadget: string }> {
    const em = h.em().fork();
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
      subtotal: '50.00',
      taxTotal: '11.50',
      deliveryTotal: '0.00',
      discountTotal: '0.00',
      total: '61.50',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const widget = em.create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'KEPT-1', name: 'Widget', primaryAssetUrl: null },
      quantity: 3,
      position: 0,
      unitPrice: '10.00',
      taxRate: '0.2300',
      lineTotal: '36.90',
    });
    const gadget = em.create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'KEPT-2', name: 'Gadget', primaryAssetUrl: null },
      quantity: 1,
      position: 1,
      unitPrice: '20.00',
      taxRate: '0.2300',
      lineTotal: '24.60',
    });
    await em.persistAndFlush([widget, gadget]);
    return { orderId: order.id, widget: widget.id, gadget: gadget.id };
  }

  /** Submit a return of `quantity` of `orderItemId`, authorize it, receive it and settle it as `resolutionType`. */
  async function settleReturn(
    orderId: string,
    orderItemId: string,
    quantity: number,
    resolutionType: 'refund' | 'credit' | 'replacement' | 'repair',
  ): Promise<string> {
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId, quantity, reasonId }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string; defaultRefundAmount: number }> } })
      .data;
    const authorized = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/authorize`,
      cookies: ADMIN_COOKIE,
    });
    expect(authorized.statusCode, authorized.body).toBe(200);
    const received = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    expect(received.statusCode, received.body).toBe(200);
    const movesMoney = resolutionType === 'refund' || resolutionType === 'credit';
    const settled = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType,
        lines: detail.items.map((it) => ({
          returnCaseItemId: it.id,
          approvedRefundAmount: movesMoney ? it.defaultRefundAmount : 0,
        })),
        ...(resolutionType === 'refund' ? { refundPaymentMethodId: randomUUID() } : {}),
      },
    });
    expect(settled.statusCode, settled.body).toBe(200);
    return detail.id;
  }

  async function issueInvoice(orderId: string): Promise<IssuedInvoice> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: IssuedInvoice }).data;
  }

  const linesOf = (invoice: IssuedInvoice) =>
    invoice.lines.map((l) => [l.name, l.quantity, l.netValue, l.grossValue]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it('invoices the kept quantity of a line returned in part and refunded in full, equal to what was paid', async () => {
    const { orderId, widget } = await seedOrder();
    const caseId = await settleReturn(orderId, widget, 1, 'refund');
    // A bank-transfer order's refund waits for a person to make the transfer;
    // no route records that it was made, so the test records it, as
    // `decimal-amounts.test.ts` seeds an issued refund.
    await withSystemScope('test: record the manual refund as made', async () => {
      const em = h.em().fork();
      const refund = await em.findOneOrFail(Refund, { returnCaseId: caseId });
      expect(refund.amount).toBe('12.30');
      refund.settlementState = 'issued';
      await em.flush();
    });

    const invoice = await issueInvoice(orderId);
    expect(linesOf(invoice)).toEqual([
      ['Gadget', 1, 20, 24.6],
      ['Widget', 2, 20, 24.6],
    ]);
    expect(invoice.vatSummary).toEqual([{ taxRate: 0.23, netTotal: 40, vatAmount: 9.2, grossTotal: 49.2 }]);
    // 61.50 received less the 12.30 refunded: the invoice and the payment agree to the cent.
    expect([invoice.grossTotal, invoice.paidTotal, invoice.amountDue, invoice.overpayment]).toEqual([49.2, 49.2, 0, 0]);
  });

  it('drops a line returned in full', async () => {
    const { orderId, gadget } = await seedOrder();
    await settleReturn(orderId, gadget, 1, 'credit');

    const invoice = await issueInvoice(orderId);
    expect(linesOf(invoice)).toEqual([['Widget', 3, 30, 36.9]]);
    expect([invoice.grossTotal, invoice.paidTotal, invoice.amountDue, invoice.overpayment]).toEqual([36.9, 36.9, 0, 0]);
  });

  it('takes off a refund still waiting for a person, which the paid side does not yet deduct', async () => {
    const { orderId, widget } = await seedOrder();
    await settleReturn(orderId, widget, 1, 'refund');

    const invoice = await issueInvoice(orderId);
    expect(linesOf(invoice)).toEqual([
      ['Gadget', 1, 20, 24.6],
      ['Widget', 2, 20, 24.6],
    ]);
    // The money side is `invoicePaidPosition`'s, unchanged: a pending refund is not deducted.
    expect([invoice.grossTotal, invoice.paidTotal, invoice.overpayment]).toEqual([49.2, 61.5, 12.3]);
  });

  it('changes nothing for a replacement', async () => {
    const { orderId, widget } = await seedOrder();
    await settleReturn(orderId, widget, 1, 'replacement');

    const invoice = await issueInvoice(orderId);
    expect(linesOf(invoice)).toEqual([
      ['Gadget', 1, 20, 24.6],
      ['Widget', 3, 30, 36.9],
    ]);
    expect([invoice.grossTotal, invoice.paidTotal, invoice.amountDue]).toEqual([61.5, 61.5, 0]);
  });

  it('changes nothing for a complaint settled with a refund', async () => {
    const { orderId, widget } = await seedOrder();
    // Seeded: a complaint needs a complaint reason and an eligible order, and
    // what is measured here is only which kinds the invoice reads.
    await withSystemScope('test: seed a settled complaint', async () => {
      const em = h.em().fork();
      const rc = em.create(ReturnCase, {
        kind: 'complaint',
        orderId,
        salesChannelId: CH,
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        statusCode: 'resolved',
        currency: 'PLN',
        resolutionType: 'refund',
        submittedAt: new Date(),
      });
      em.create(ReturnCaseItem, {
        returnCaseId: rc.id,
        orderItemId: widget,
        productId: randomUUID(),
        productName: 'Widget',
        quantity: 1,
        defaultRefundAmount: '12.30',
        approvedRefundAmount: '12.30',
      });
      em.create(Refund, {
        returnCaseId: rc.id,
        resolutionType: 'refund',
        amount: '12.30',
        currency: 'PLN',
        settlementState: 'pending_manual',
      });
      await em.flush();
    });

    const invoice = await issueInvoice(orderId);
    expect(linesOf(invoice)).toEqual([
      ['Gadget', 1, 20, 24.6],
      ['Widget', 3, 30, 36.9],
    ]);
  });

  it('degrades without returns: every line is invoiced, as before', async () => {
    const { orderId, widget } = await seedOrder();
    await settleReturn(orderId, widget, 1, 'credit');

    const invoice = await withModuleOff('returns', 'deactivated', () => issueInvoice(orderId));
    expect(linesOf(invoice)).toEqual([
      ['Gadget', 1, 20, 24.6],
      ['Widget', 3, 30, 36.9],
    ]);
    expect([invoice.grossTotal, invoice.paidTotal]).toEqual([61.5, 61.5]);
  });
});
