import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitPriceHalfUp, type CorrectiveInvoicePort, type OrderReturnContextPort } from '@endora-commerce/contracts';
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
import { emptyCustomerBasket } from '../../../helpers/customer-basket.js';

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
 * §10.18 (owner ruling of 2026-10-25): a unit price is carried at four places,
 * unrounded, from the price book through the cart line, the order line and the
 * invoice line; only the line value, `unit × quantity`, is rounded, once. The
 * §10.17 vectors are recomputed under it (9.0450 × 3 is 27.135, so 27.14, not
 * 27.15), and the U vectors are sub-cent prices: 0.0125 × 10 000 is 125.00.
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
/** §10.18 — sub-cent unit prices: a screw, a washer and a 1.505 part. */
const SUB_CENT: Record<string, string> = {
  [SEED_PRODUCT_101_ID]: '0.0125',
  [SEED_PRODUCT_102_ID]: '0.0150',
  [SEED_PRODUCT_103_ID]: '1.5050',
};

interface Vector {
  id: string;
  /** The vector's resolver amounts, when they are not {@link RESOLVER}'s. */
  resolver?: Record<string, string>;
  lines: Array<{ productId: string; quantity: number }>;
  /** The rate per product type: 101 and 103 are `simple`, 102 is `virtual`. */
  rates: Record<string, number>;
  /** Per line: unit price (four places, as carried), net and (informational) gross. */
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
  /** An order-level discount, taken off the gross without VAT. */
  discount?: string;
  /** Lines that are not returnable: they come back through a complaint. */
  complaints?: number[];
}

const VECTORS: Vector[] = [
  {
    id: 'A1',
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    rates: { simple: 0.23 },
    expectedLines: [['29.4950', '29.50', '36.29']],
    rows: [[0.23, '29.50', '6.79', '36.29']],
    net: '29.50',
    tax: '6.79',
    total: '38.79',
    returns: [[1]],
    credited: [['36.29', '29.50', '6.79']],
  },
  {
    // V3, full return: 9.0450 × 3 = 27.135, so 27.14 at 8 % (§10.18: the line value is the
    // rounding point; at two places on intake it was 9.05 × 3 = 27.15), refunded at what was invoiced.
    id: 'A2',
    lines: [{ productId: SEED_PRODUCT_103_ID, quantity: 3 }],
    rates: { simple: 0.08 },
    expectedLines: [['9.0450', '27.14', '29.31']],
    rows: [[0.08, '27.14', '2.17', '29.31']],
    net: '27.14',
    tax: '2.17',
    total: '31.81',
    returns: [[3]],
    credited: [['29.31', '27.14', '2.17']],
  },
  {
    id: 'A3',
    lines: [{ productId: SEED_PRODUCT_102_ID, quantity: 1 }],
    rates: { virtual: 0.05 },
    expectedLines: [['0.6950', '0.70', '0.74']],
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
      ['29.4950', '29.50', '36.29'],
      ['0.6950', '0.70', '0.74'],
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
    // V3, partial returns: 2 of 3 is 18.09 net (9.0450 × 2) + 1.45 VAT, then the last
    // one the rest of what was invoiced — 9.05 net + 0.72 VAT.
    id: 'V3p',
    lines: [{ productId: SEED_PRODUCT_103_ID, quantity: 3 }],
    rates: { simple: 0.08 },
    expectedLines: [['9.0450', '27.14', '29.31']],
    rows: [[0.08, '27.14', '2.17', '29.31']],
    net: '27.14',
    tax: '2.17',
    total: '31.81',
    returns: [[2], [1]],
    credited: [
      ['19.54', '18.09', '1.45'],
      ['9.77', '9.05', '0.72'],
    ],
  },
  {
    // L1 (owner ruling: a line's gross is its own rounding): two lines at 23 %.
    // 0.6950 × 5 = 3.475, so 3.48; the rate's VAT is 32.98 × 0.23 = 7.5854 → 7.59; the
    // lines show 36.29 and 4.28 — 40.57, the products' gross.
    id: 'L1',
    lines: [
      { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      { productId: SEED_PRODUCT_102_ID, quantity: 5 },
    ],
    rates: { simple: 0.23, virtual: 0.23 },
    expectedLines: [
      ['29.4950', '29.50', '36.29'],
      ['0.6950', '3.48', '4.28'],
    ],
    rows: [[0.23, '32.98', '7.59', '40.57']],
    net: '32.98',
    tax: '7.59',
    total: '43.07',
    returns: [[1, 5]],
    credited: [['40.57', '32.98', '7.59']],
  },
  {
    // R2 (review of PR #423): two returns of 1 of 2 × 29.4950 at 23 %. Paid 72.56 (58.99 net);
    // cumulatively the first refunds 36.29 (29.50 net), the second the rest, 36.27 (29.49 net).
    id: 'R2',
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
    rates: { simple: 0.23 },
    expectedLines: [['29.4950', '58.99', '72.56']],
    rows: [[0.23, '58.99', '13.57', '72.56']],
    net: '58.99',
    tax: '13.57',
    total: '75.06',
    returns: [[1], [1]],
    credited: [
      ['36.29', '29.50', '6.79'],
      ['36.27', '29.49', '6.78'],
    ],
  },
  {
    // DC1 (review of PR #423): a 10.00 order-level discount on 2 × 29.4950 at 23 %.
    // The products were charged 72.56 − 10.00 = 62.56; each return refunds its
    // half less the 5.00 of discount it carries, and the correction credits the
    // goods as invoiced and the 5.00 back on 0 %.
    id: 'DC1',
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
    rates: { simple: 0.23 },
    expectedLines: [['29.4950', '58.99', '72.56']],
    rows: [[0.23, '58.99', '13.57', '72.56']],
    net: '58.99',
    tax: '13.57',
    total: '65.06',
    discount: '10.00',
    returns: [[1], [1]],
    credited: [
      ['31.29', '24.50', '6.79'],
      ['31.27', '24.49', '6.78'],
    ],
  },
  {
    // C1 (review of PR #423): the second line is not returnable and comes back
    // through a complaint; it is in the same accounting, so together the two
    // refund 40.57, what the products were charged.
    id: 'C1',
    lines: [
      { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      { productId: SEED_PRODUCT_102_ID, quantity: 5 },
    ],
    rates: { simple: 0.23, virtual: 0.23 },
    expectedLines: [
      ['29.4950', '29.50', '36.29'],
      ['0.6950', '3.48', '4.28'],
    ],
    rows: [[0.23, '32.98', '7.59', '40.57']],
    net: '32.98',
    tax: '7.59',
    total: '43.07',
    complaints: [1],
    returns: [
      [1, 0],
      [0, 5],
    ],
    credited: [
      ['36.29', '29.50', '6.79'],
      ['4.28', '3.48', '0.80'],
    ],
  },
  // §10.18 — sub-cent unit prices (owner ruling of 2026-10-25).
  {
    // U1: a screw at 0.0125 × 10 000 is 125.00. Rounded to two places at intake it was
    // 0.01 × 10 000 = 100.00.
    id: 'U1',
    resolver: SUB_CENT,
    lines: [{ productId: SEED_PRODUCT_101_ID, quantity: 10_000 }],
    rates: { simple: 0.23 },
    expectedLines: [['0.0125', '125.00', '153.75']],
    rows: [[0.23, '125.00', '28.75', '153.75']],
    net: '125.00',
    tax: '28.75',
    total: '156.25',
    returns: [[10_000]],
    credited: [['153.75', '125.00', '28.75']],
  },
  {
    // U2: 0.0150 × 3 = 0.045, half-up 0.05 (at two places on intake: 0.02 × 3 = 0.06).
    id: 'U2',
    resolver: SUB_CENT,
    lines: [{ productId: SEED_PRODUCT_102_ID, quantity: 3 }],
    rates: { virtual: 0.23 },
    expectedLines: [['0.0150', '0.05', '0.06']],
    rows: [[0.23, '0.05', '0.01', '0.06']],
    net: '0.05',
    tax: '0.01',
    total: '2.56',
    returns: [[3]],
    credited: [['0.06', '0.05', '0.01']],
  },
  {
    // U3: three sub-cent lines at two rates. 23 %: 125.00 + 1.5050 × 7 (10.535 → 10.54) =
    // 135.54, VAT 31.1742 → 31.17; 8 %: 0.0150 × 333 (4.995 → 5.00), VAT 0.40.
    id: 'U3',
    resolver: SUB_CENT,
    lines: [
      { productId: SEED_PRODUCT_101_ID, quantity: 10_000 },
      { productId: SEED_PRODUCT_102_ID, quantity: 333 },
      { productId: SEED_PRODUCT_103_ID, quantity: 7 },
    ],
    rates: { simple: 0.23, virtual: 0.08 },
    expectedLines: [
      ['0.0125', '125.00', '153.75'],
      ['0.0150', '5.00', '5.40'],
      ['1.5050', '10.54', '12.96'],
    ],
    rows: [
      [0.08, '5.00', '0.40', '5.40'],
      [0.23, '135.54', '31.17', '166.71'],
    ],
    net: '140.54',
    tax: '31.57',
    total: '174.61',
    returns: [[10_000, 333, 7]],
    credited: [['172.11', '140.54', '31.57']],
  },
  {
    // U5: part of a sub-cent line comes back. 111 of 333 × 0.0150 at 23 %: 1.665 → 1.67 net,
    // 0.38 VAT, 2.05; then the other 222: the rest of 6.15, 4.10 — 3.33 net, 0.77 VAT.
    id: 'U5',
    resolver: SUB_CENT,
    lines: [{ productId: SEED_PRODUCT_102_ID, quantity: 333 }],
    rates: { virtual: 0.23 },
    expectedLines: [['0.0150', '5.00', '6.15']],
    rows: [[0.23, '5.00', '1.15', '6.15']],
    net: '5.00',
    tax: '1.15',
    total: '8.65',
    returns: [[111], [222]],
    credited: [
      ['2.05', '1.67', '0.38'],
      ['4.10', '3.33', '0.77'],
    ],
  },
];

const two = (n: number | string) => Number(n).toFixed(2);

describe('worked examples — §10.17 and §10.18 every document an order produces agrees', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.getConnection().execute(`update "products" set "type" = 'virtual' where "id" = ?`, [SEED_PRODUCT_102_ID]);
    // The seed stocks 101 only, and a §10.18 screw is ordered by the ten thousand.
    for (const productId of [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID]) {
      em.create(StockLevel, { productId, warehouseId: '00000000-0000-4000-8000-00000000d017', onHand: 100_000, reserved: 0 });
    }
    await em.flush();
    await em.getConnection().execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
    const method = await em.findOneOrFail(PaymentMethod, { id: SEED_PAYMENT_METHOD_ID });
    method.additionalPrice = SURCHARGE;
    await em.persistAndFlush(method);
    await setSellerSettings(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The vector's resolver amounts, written as base prices; the engine is told, as an audited write would. */
  async function priceAt(resolver: Record<string, string>): Promise<void> {
    const em = h.em();
    for (const [productId, amount] of Object.entries(resolver)) await seedBasePriceSql(em, productId, amount);
    await (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
      .handle.pricingGeneration.bump();
  }

  for (const v of VECTORS) {
    const resolver = v.resolver ?? RESOLVER;
    it(`${v.id} — ${v.lines.map((l) => `${resolver[l.productId]} × ${l.quantity}`).join(' + ')}`, async () => {
      await priceAt(resolver);
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
        // An order-level discount, as the promotions engine answers one.
        ...(v.discount
          ? {
              promotion: {
                applyToCart: async (snapshot: { deliveryTotal: number }) => ({
                  subtotal: 0,
                  discountTotal: Number(v.discount),
                  deliveryTotal: snapshot.deliveryTotal,
                  total: 0,
                  appliedPromotions: [],
                }),
              },
            }
          : {}),
      } as never);
      const ctx = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
      const methods = { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID };

      // The cart, empty: a vector that failed before placement leaves its lines behind.
      await emptyCustomerBasket(h, {
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
        // Four places, unrounded (§10.18): only the line value is rounded.
        expect(unitPriceHalfUp(item.unitPrice.amount)).toBe(v.expectedLines[i]![0]);
        expect(String(item.lineTotal.amount)).toBe(String(Number(v.expectedLines[i]![1])));
      });
      expect(String(cartData.subtotal.amount)).toBe(String(Number(v.net)));

      // The admin's create-order preview prices the same lines the same way.
      const adminPreview = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders/preview',
        cookies: ADMIN_COOKIE,
        payload: {
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
          items: v.lines,
        },
      });
      expect(adminPreview.statusCode, adminPreview.body).toBe(200);
      const previewLines = (adminPreview.json() as { data: { lines: Array<{ productId: string; unitPrice: string; lineTotal: number }> } })
        .data.lines;
      v.lines.forEach((line, i) => {
        const previewLine = previewLines.find((l) => l.productId === line.productId)!;
        expect([previewLine.unitPrice, two(previewLine.lineTotal)]).toEqual([v.expectedLines[i]![0], v.expectedLines[i]![1]]);
      });

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
        expect([unitPriceHalfUp(item.unitPrice), two(item.lineTotal)]).toEqual([v.expectedLines[i]![0], v.expectedLines[i]![2]]);
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
        const invLine = inv.lines.find((l) => unitPriceHalfUp(l.unitNetPrice) === v.expectedLines[i]![0])!;
        expect([invLine.quantity, unitPriceHalfUp(invLine.unitNetPrice), two(invLine.netValue), two(invLine.grossValue)]).toEqual([
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
        two(Number(v.net) + Number(SURCHARGE) - Number(v.discount ?? 0)),
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
        const complained = new Set((v.complaints ?? []).map((i) => context.lines.find((l) => l.productId === v.lines[i]!.productId)!.orderItemId));
        const refunds = caseDefaultRefunds({
          vatMethod: context.vatMethod,
          productsPaidTotal: context.productsPaidTotal,
          discountTotal: context.discountTotal,
          orderLines: context.lines.map((l) => ({
            orderItemId: l.orderItemId,
            unitNetPrice: l.unitNetPrice,
            taxRate: l.taxRate,
            purchasedQty: l.purchasedQty,
            paidLineAmount: l.paidLineAmount.toFixed(2),
            returnable: !complained.has(l.orderItemId),
          })),
          earlier,
          current,
        });
        const refundTotal = refunds.reduce((sum, r) => sum + Math.round(Number(r.refund) * 100), 0) / 100;
        const correction = await cradle.correctiveInvoicePort.createCorrection({
          orderId,
          lines: current.map((c, i) => ({
            orderItemId: c.orderItemId,
            productName: context.lines.find((l) => l.orderItemId === c.orderItemId)!.name,
            quantity: c.quantity,
            amount: Number(refunds[i]!.refund),
            ...(Number(refunds[i]!.discount) > 0 ? { discount: Number(refunds[i]!.discount) } : {}),
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
        current.forEach((cur, i) => earlier.push({ ...cur, defaultRefundAmount: refunds[i]!.refund }));
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
      discountTotal: context.discountTotal,
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
    expect(refunds.map((r) => r.refund)).toEqual(['36.28', '4.52']);
    const correction = await cradle.correctiveInvoicePort.createCorrection({
      orderId: order.id,
      lines: [lineA, lineB].map((l, i) => ({ orderItemId: l.id, productName: l.productSnapshot.name, quantity: 1, amount: Number(refunds[i]!.refund) })),
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
