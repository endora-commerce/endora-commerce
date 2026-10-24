import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CorrectiveInvoicePort, OrderReturnContextPort } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { InMemoryMailer } from '../../../../../packages/modules/email/src/backend/services/mailer.js';
import { OrderService, type OrderEventBus } from '../../../../../packages/modules/orders/dist/backend/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';
import { caseDefaultRefunds } from '../../../../../packages/modules/returns/dist/backend/domain/refund-math.js';
import { orderServiceNeighbours } from '../../../helpers/orders-neighbour-ports.js';
import { Invoice, Order, OrderItem, Payment, PaymentMethod, StockLevel } from '../../../helpers/package-entities.js';
import { seedBasePriceSql } from '../../../helpers/price-book-sql.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../../helpers/sales-channel-fixtures.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { ADMIN_COOKIE, setSellerSettings } from '../../invoices/helpers.js';

/**
 * `specs/pricing/worked-examples.md` §10.17 (issue #417, owner ruling of
 * 2026-10-24) — x.xx50 resolver amounts at 23 %, 8 % and 5 % VAT, under the one
 * VAT method (per rate, VAT on the sum of the nets, rounded once), give the
 * same figures on every document an order produces: the cart, the checkout
 * preview, the placed order (its lines and totals), the payment it opens, its
 * proforma, the order-confirmation e-mail, the VAT invoice (lines, the per-rate
 * summary, the totals and the amount recorded as paid), a correction crediting
 * what a return refunds by default — the whole order, or part of a line — and
 * the admin CSV export.
 *
 * The tax rate is resolved per product type, so 102 is made a `virtual`
 * product and each vector states its rate per type; V2 is one order at two
 * rates. The payment method carries a 2.50 surcharge, which every document adds
 * without tax: the order on its gross, the invoice as a 0 % line.
 */
const SESSION = { b2b_session: 'stub-customer-session' };
const SURCHARGE = '2.50';
const RESOLVER: Record<string, string> = {
  [SEED_PRODUCT_101_ID]: '29.4950',
  [SEED_PRODUCT_102_ID]: '0.6950',
  [SEED_PRODUCT_103_ID]: '9.0450',
};

interface Vector {
  id: string;
  lines: Array<{ productId: string; quantity: number }>;
  /** The rate per product type: 101 and 103 are `simple`, 102 is `virtual`. */
  rates: Record<string, number>;
  /** Per line: unit price, net and (informational) gross. */
  expectedLines: Array<[string, string, string]>;
  /** Per rate: [rate, net, VAT, gross]. */
  rows: Array<[number, string, string, string]>;
  net: string;
  tax: string;
  /** Products' gross + the 2.50 surcharge. */
  total: string;
  /** Return cases, in order: the quantity of each line each one sends back. */
  returns: number[][];
  /** What the correction for each return credits: gross, net, VAT. */
  credited: Array<[string, string, string]>;
}

const VECTORS: Vector[] = [
  {
    id: 'A1',
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    rates: { simple: 0.23 },
    expectedLines: [['29.50', '29.50', '36.29']],
    rows: [[0.23, '29.50', '6.79', '36.29']],
    net: '29.50',
    tax: '6.79',
    total: '38.79',
    returns: [[1]],
    credited: [['36.29', '29.50', '6.79']],
  },
  {
    // V3, full return: 9.05 × 3 at 8 % is refunded at what was invoiced, 29.32.
    id: 'A2',
    lines: [{ productId: SEED_PRODUCT_103_ID, quantity: 3 }],
    rates: { simple: 0.08 },
    expectedLines: [['9.05', '27.15', '29.32']],
    rows: [[0.08, '27.15', '2.17', '29.32']],
    net: '27.15',
    tax: '2.17',
    total: '31.82',
    returns: [[3]],
    credited: [['29.32', '27.15', '2.17']],
  },
  {
    id: 'A3',
    lines: [{ productId: SEED_PRODUCT_102_ID, quantity: 1 }],
    rates: { virtual: 0.05 },
    expectedLines: [['0.70', '0.70', '0.74']],
    rows: [[0.05, '0.70', '0.04', '0.74']],
    net: '0.70',
    tax: '0.04',
    total: '3.24',
    returns: [[1]],
    credited: [['0.74', '0.70', '0.04']],
  },
  {
    // V2: two rates in one order. VAT per rate: 6.785 → 6.79 and 0.035 → 0.04.
    id: 'V2',
    lines: [
      { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      { productId: SEED_PRODUCT_102_ID, quantity: 1 },
    ],
    rates: { simple: 0.23, virtual: 0.05 },
    expectedLines: [
      ['29.50', '29.50', '36.29'],
      ['0.70', '0.70', '0.74'],
    ],
    rows: [
      [0.05, '0.70', '0.04', '0.74'],
      [0.23, '29.50', '6.79', '36.29'],
    ],
    net: '30.20',
    tax: '6.83',
    total: '39.53',
    returns: [[1, 1]],
    credited: [['37.03', '30.20', '6.83']],
  },
  {
    // V3, partial returns: 2 of 3 refunds 18.10 net + 1.45 VAT, then the last
    // one the rest of what was invoiced — 9.05 net + 0.72 VAT.
    id: 'V3p',
    lines: [{ productId: SEED_PRODUCT_103_ID, quantity: 3 }],
    rates: { simple: 0.08 },
    expectedLines: [['9.05', '27.15', '29.32']],
    rows: [[0.08, '27.15', '2.17', '29.32']],
    net: '27.15',
    tax: '2.17',
    total: '31.82',
    returns: [[2], [1]],
    credited: [
      ['19.55', '18.10', '1.45'],
      ['9.77', '9.05', '0.72'],
    ],
  },
  {
    // L1 (owner ruling: a line's gross is its own rounding): two lines at 23 %.
    // The rate's VAT is 33.00 × 0.23 = 7.59; the lines show 36.29 and 4.31 —
    // 40.60 beside a 40.59 products' gross, the accepted cent.
    id: 'L1',
    lines: [
      { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      { productId: SEED_PRODUCT_102_ID, quantity: 5 },
    ],
    rates: { simple: 0.23, virtual: 0.23 },
    expectedLines: [
      ['29.50', '29.50', '36.29'],
      ['0.70', '3.50', '4.31'],
    ],
    rows: [[0.23, '33.00', '7.59', '40.59']],
    net: '33.00',
    tax: '7.59',
    total: '43.09',
    returns: [[1, 5]],
    credited: [['40.59', '33.00', '7.59']],
  },
  {
    // R2 (review of PR #423): two returns of 1 of 2 × 29.50 at 23 %. Paid 72.57;
    // each case on its own would refund 36.29 twice, 72.58. Cumulatively: 36.29, then 36.28.
    id: 'R2',
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
    rates: { simple: 0.23 },
    expectedLines: [['29.50', '59.00', '72.57']],
    rows: [[0.23, '59.00', '13.57', '72.57']],
    net: '59.00',
    tax: '13.57',
    total: '75.07',
    returns: [[1], [1]],
    credited: [
      ['36.29', '29.50', '6.79'],
      ['36.28', '29.50', '6.78'],
    ],
  },
];

const two = (n: number | string) => Number(n).toFixed(2);

describe('worked examples — §10.17 every document an order produces agrees', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [productId, amount] of Object.entries(RESOLVER)) await seedBasePriceSql(em, productId, amount);
    await em.getConnection().execute(`update "products" set "type" = 'virtual' where "id" = ?`, [SEED_PRODUCT_102_ID]);
    // The seed stocks 101 only.
    for (const productId of [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID]) {
      em.create(StockLevel, { productId, warehouseId: '00000000-0000-4000-8000-00000000d017', onHand: 100, reserved: 0 });
    }
    await em.flush();
    const method = await em.findOneOrFail(PaymentMethod, { id: SEED_PAYMENT_METHOD_ID });
    method.additionalPrice = SURCHARGE;
    await em.persistAndFlush(method);
    await setSellerSettings(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  for (const v of VECTORS) {
    it(`${v.id} — ${v.lines.map((l) => `${RESOLVER[l.productId]} × ${l.quantity}`).join(' + ')}`, async () => {
      const mailer = new InMemoryMailer();
      const registry = new PaymentAdapterRegistry();
      for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
      const service = new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
        neighbours: orderServiceNeighbours(h.em),
        resolveTaxRate: async ({ productType }: { productType: string }) => {
          const rate = v.rates[productType];
          if (rate === undefined) throw new Error(`No rate for ${productType} in ${v.id}`);
          return rate;
        },
        paymentAdapters: () => registry,
        orderStatusRegistry: () => new EnumOrderStatusRegistry(),
        mailer,
      });
      const ctx = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
      const methods = { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID };

      // The cart, empty: a vector that failed before placement leaves its lines behind.
      await h.cartService()?.clearForCustomer({
        ...CUSTOMER_COOKIES[SESSION.b2b_session]!,
        salesChannelId: await systemDefaultSalesChannelId(h.em()),
      });
      for (const line of v.lines) {
        const added = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: line });
        expect(added.statusCode, added.body).toBe(200);
      }
      const cart = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
      const cartData = (cart.json() as {
        data: {
          items: Array<{ productId: string; unitPrice: { amount: number }; lineTotal: { amount: number } }>;
          subtotal: { amount: number };
        };
      }).data;
      v.lines.forEach((line, i) => {
        const item = cartData.items.find((it) => it.productId === line.productId)!;
        expect(two(item.unitPrice.amount)).toBe(v.expectedLines[i]![0]);
        expect(String(item.lineTotal.amount)).toBe(String(Number(v.expectedLines[i]![1])));
      });
      expect(String(cartData.subtotal.amount)).toBe(String(Number(v.net)));

      // The checkout preview.
      const preview = await service.previewTotal(ctx, methods);
      expect([preview.subtotal, preview.taxTotal, preview.total].map(two)).toEqual([v.net, v.tax, v.total]);

      // The placed order, the payment it opened and its proforma.
      const placed = await service.placeOrder(ctx, {
        ...methods,
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
      });
      const orderId = (placed as { order?: { id: string }; id?: string }).order?.id ?? (placed as { id: string }).id;
      const order = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, cookies: ADMIN_COOKIE });
      expect(order.statusCode, order.body).toBe(200);
      const o = (order.json() as {
        data: {
          businessId: string;
          subtotal: number;
          taxTotal: number;
          total: number;
          items: Array<{ productId: string; unitPrice: number; lineTotal: number }>;
        };
      }).data;
      expect([o.subtotal, o.taxTotal, o.total].map(two)).toEqual([v.net, v.tax, v.total]);
      v.lines.forEach((line, i) => {
        const item = o.items.find((it) => it.productId === line.productId)!;
        expect([two(item.unitPrice), two(item.lineTotal)]).toEqual([v.expectedLines[i]![0], v.expectedLines[i]![2]]);
      });
      const payment = await h.em().fork().findOneOrFail(Payment, { orderId });
      const proforma = await h.em().fork().findOneOrFail(Invoice, { orderId, kind: 'proforma' });
      expect([two(payment.amount), two(proforma.total)]).toEqual([v.total, v.total]);

      // The order-confirmation e-mail.
      expect(mailer.sent).toHaveLength(1);
      const mail = mailer.sent[0]!.text ?? '';
      for (const expected of v.expectedLines) expect(mail).toContain(`— ${expected[2]} PLN`);
      expect(mail).toContain(`: ${v.net} PLN`);
      expect(mail).toContain(`: ${v.tax} PLN`);
      expect(mail).toMatch(new RegExp(`: ${v.total.replace('.', '\\.')} PLN`));

      // The VAT invoice, issued for the order once it is paid.
      const paidEm = h.em().fork();
      const paidOrder = await paidEm.findOneOrFail(Order, { id: orderId });
      paidOrder.paymentStatus = 'paid';
      await paidEm.flush();
      const issued = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/invoices`,
        cookies: ADMIN_COOKIE,
        payload: { kind: 'invoice' },
      });
      expect(issued.statusCode, issued.body).toBe(201);
      const inv = (issued.json() as {
        data: {
          netTotal: number;
          taxTotal: number;
          grossTotal: number;
          paidTotal: number;
          lines: Array<{ quantity: number; unitNetPrice: number; netValue: number; grossValue: number }>;
          vatSummary: Array<{ taxRate: number; netTotal: number; vatAmount: number; grossTotal: number }>;
        };
      }).data;
      v.lines.forEach((line, i) => {
        // The invoice lists the lines in the order's arrangement: find each by its unit price.
        const invLine = inv.lines.find((l) => two(l.unitNetPrice) === v.expectedLines[i]![0])!;
        expect([invLine.quantity, two(invLine.unitNetPrice), two(invLine.netValue), two(invLine.grossValue)]).toEqual([
          line.quantity,
          v.expectedLines[i]![0],
          v.expectedLines[i]![1],
          v.expectedLines[i]![2],
        ]);
      });
      for (const [rate, net, vat, gross] of v.rows) {
        const row = inv.vatSummary.find((r) => r.taxRate === rate)!;
        expect([row.netTotal, row.vatAmount, row.grossTotal].map(two)).toEqual([net, vat, gross]);
      }
      // Net + the 0 % surcharge line; VAT; gross and the amount recorded as paid
      // are the order total — the amount the payment and the proforma carry.
      expect([inv.netTotal, inv.taxTotal, inv.grossTotal, inv.paidTotal].map(two)).toEqual([
        two(Number(v.net) + Number(SURCHARGE)),
        v.tax,
        v.total,
        v.total,
      ]);

      // What each return refunds by default — cumulatively — and the correction crediting it.
      const cradle = h.container.cradle as unknown as {
        orderReturnContextPort: OrderReturnContextPort;
        correctiveInvoicePort: CorrectiveInvoicePort;
      };
      const context = (await cradle.orderReturnContextPort.getReturnContext(orderId))!;
      const earlier: Array<{ orderItemId: string; quantity: number; defaultRefundAmount: string }> = [];
      const credited: Array<[string, string, string]> = [];
      for (const [caseIndex, quantities] of v.returns.entries()) {
        const current = v.lines
          .map((line, i) => ({ orderItemId: context.lines.find((l) => l.productId === line.productId)!.orderItemId, quantity: quantities[i]! }))
          .filter((c) => c.quantity > 0);
        const refunds = caseDefaultRefunds({
          vatMethod: context.vatMethod,
          productsPaidTotal: context.productsPaidTotal,
          orderLines: context.lines.map((l) => ({
            orderItemId: l.orderItemId,
            unitNetPrice: l.unitNetPrice,
            taxRate: l.taxRate,
            purchasedQty: l.purchasedQty,
            paidLineAmount: l.paidLineAmount.toFixed(2),
            returnable: true,
          })),
          earlier,
          current,
        });
        const refundTotal = refunds.reduce((sum, r) => sum + Math.round(Number(r) * 100), 0) / 100;
        const correction = await cradle.correctiveInvoicePort.createCorrection({
          orderId,
          lines: current.map((c, i) => ({
            orderItemId: c.orderItemId,
            productName: context.lines.find((l) => l.orderItemId === c.orderItemId)!.name,
            quantity: c.quantity,
            amount: Number(refunds[i]),
          })),
          total: refundTotal,
          currency: 'PLN',
          idempotencyKey: `money-agreement-${v.id}-${orderId}-${caseIndex}`,
        });
        expect(correction.issued).toBe(true);
        const corrected = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/invoices/${(correction as { invoiceId: string }).invoiceId}`,
          cookies: ADMIN_COOKIE,
        });
        expect(corrected.statusCode, corrected.body).toBe(200);
        const c = (corrected.json() as { data: { netTotal: number; taxTotal: number; grossTotal: number } }).data;
        credited.push([two(c.grossTotal), two(c.netTotal), two(c.taxTotal)]);
        current.forEach((cur, i) => earlier.push({ ...cur, defaultRefundAmount: refunds[i]! }));
      }
      expect(credited).toEqual(v.credited);

      // The admin CSV export.
      const csv = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders/export', cookies: ADMIN_COOKIE });
      expect(csv.statusCode, csv.body).toBe(200);
      const [header, ...rows] = csv.body.split('\r\n');
      const columns = header!.split(',');
      const row = rows.map((r) => r.split(',')).find((cells) => cells[columns.indexOf('businessId')] === o.businessId);
      expect(row?.[columns.indexOf('total')]).toBe(v.total);
    });
  }

  it('L0 — an order placed before 0.108.0 refunds and credits what it charged, and its new invoice shows the cent still due', async () => {
    // Stored by the rule of its day: line grosses 36.29 and 4.52, the lines'
    // exact taxes summed and rounded once (7.00), total 40.80 — and 40.80 captured.
    const em = h.em().fork();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: await systemDefaultSalesChannelId(em),
      status: 'completed',
      paymentStatus: 'paid',
      deliveryAddress: { recipientName: 'Buyer', street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-002', country: 'PL' },
      billingAddress: {
        recipientName: 'Buyer',
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-002',
        country: 'PL',
        companyName: 'Buyer Sp. z o.o.',
        taxId: '1231231230',
      },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'Kurier', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'Przelew', kind: 'bank_transfer' },
      subtotal: '33.80',
      taxTotal: '7.00',
      deliveryTotal: '0.00',
      discountTotal: '0.00',
      total: '40.80',
      currency: 'PLN',
      placedAt: new Date('2026-09-01T10:00:00Z'),
    });
    await em.persistAndFlush(order);
    const lineA = em.create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'L0-A', name: 'A', primaryAssetUrl: null },
      quantity: 1,
      position: 0,
      unitPrice: '29.50',
      taxRate: '0.2300',
      lineTotal: '36.29',
    });
    const lineB = em.create(OrderItem, {
      orderId: order.id,
      productId: randomUUID(),
      productSnapshot: { sku: 'L0-B', name: 'B', primaryAssetUrl: null },
      quantity: 1,
      position: 1,
      unitPrice: '4.30',
      taxRate: '0.0500',
      lineTotal: '4.52',
    });
    em.create(Payment, { orderId: order.id, paymentMethodId: randomUUID(), status: 'paid', amount: '40.80', currency: 'PLN', paidAt: new Date() });
    await em.flush();

    // The invoice, issued now, takes VAT per rate: 7.01, gross 40.81 — 40.80 was paid.
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${order.id}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const inv = (issued.json() as { data: { taxTotal: number; grossTotal: number; paidTotal: number; amountDue: number } }).data;
    expect([inv.taxTotal, inv.grossTotal, inv.paidTotal, inv.amountDue].map(two)).toEqual(['7.01', '40.81', '40.80', '0.01']);

    // A full return refunds what the order charged, read from what it stored.
    const cradle = h.container.cradle as unknown as {
      orderReturnContextPort: OrderReturnContextPort;
      correctiveInvoicePort: CorrectiveInvoicePort;
    };
    const context = (await cradle.orderReturnContextPort.getReturnContext(order.id))!;
    expect([context.vatMethod, context.productsPaidTotal]).toEqual([null, '40.80']);
    const refunds = caseDefaultRefunds({
      vatMethod: context.vatMethod,
      productsPaidTotal: context.productsPaidTotal,
      orderLines: context.lines.map((l) => ({
        orderItemId: l.orderItemId,
        unitNetPrice: l.unitNetPrice,
        taxRate: l.taxRate,
        purchasedQty: l.purchasedQty,
        paidLineAmount: l.paidLineAmount.toFixed(2),
        returnable: true,
      })),
      earlier: [],
      current: [lineA, lineB].map((l) => ({ orderItemId: l.id, quantity: 1 })),
    });
    // The line totals add up to 40.81; the order charged 40.80, and a complete return refunds exactly that.
    expect(refunds).toEqual(['36.28', '4.52']);
    const correction = await cradle.correctiveInvoicePort.createCorrection({
      orderId: order.id,
      lines: [lineA, lineB].map((l, i) => ({ orderItemId: l.id, productName: l.productSnapshot.name, quantity: 1, amount: Number(refunds[i]) })),
      total: 40.8,
      currency: 'PLN',
      idempotencyKey: `money-agreement-L0-${order.id}`,
    });
    const corrected = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${(correction as { invoiceId: string }).invoiceId}`,
      cookies: ADMIN_COOKIE,
    });
    const c = (corrected.json() as { data: { netTotal: number; taxTotal: number; grossTotal: number } }).data;
    // The credit is what was paid: the 0.01 of VAT never paid is never credited.
    expect([c.grossTotal, c.netTotal, c.taxTotal].map(two)).toEqual(['40.80', '33.80', '7.00']);
  });
});
