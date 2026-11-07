import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Invoice, InvoiceLine, Order, OrderItem, Payment, Refund } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { setSellerSettings } from '../invoices/helpers.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #417, review of PR #423 (B1) — what one settlement refunds and what its
 * correction credits come from **one** set of lines, every line of the case:
 * a line the request leaves out keeps its stored approved amount, and is both
 * refunded and credited at it. And the settlements of one order are serialised,
 * so two of them cannot both read the same earlier corrections.
 */
describe('returns — what a settlement refunds and credits', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    // Issuance refuses without the seller's own company data.
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueInvoice(orderId: string): Promise<void> {
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
  }

  /** Create a case over `lines`, authorize it and move it to `received`. */
  async function receivedCase(
    orderId: string,
    lines: Array<{ orderItemId: string; quantity: number }>,
  ): Promise<{ id: string; items: Array<{ id: string; orderItemId: string; defaultRefundAmount: number }> }> {
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: lines.map((l) => ({ ...l, reasonId })) },
    });
    expect(created.statusCode, created.body).toBe(201);
    const detail = (
      created.json() as {
        data: { id: string; items: Array<{ id: string; orderItemId: string; defaultRefundAmount: number }> };
      }
    ).data;
    for (const step of [
      { url: `/api/v1/admin/returns/${detail.id}/authorize` },
      { url: `/api/v1/admin/returns/${detail.id}/transition`, payload: { to: 'received' } },
    ]) {
      const res = await h.app.inject({ method: 'POST', cookies: ADMIN_COOKIE, ...step });
      expect(res.statusCode, res.body).toBeLessThan(300);
    }
    return detail;
  }

  const settle = (id: string, lines: Array<{ returnCaseItemId: string; approvedRefundAmount: number }>) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'credit', lines },
    });

  const corrections = (orderId: string) =>
    withSystemScope('test: read the corrections', async () => {
      const em = h.em().fork();
      const invoices = await em.find(Invoice, { orderId, kind: 'correction' });
      return Promise.all(
        invoices.map(async (inv) => ({
          total: inv.total,
          netTotal: inv.netTotal,
          taxTotal: inv.taxTotal,
          lines: await em.find(InvoiceLine, { invoiceId: inv.id }),
        })),
      );
    });

  it('refunds and credits a line the request leaves out at its stored approved amount', async () => {
    // 3 × 100.00 and 1 × 50.00 at 0 %; the case returns one of each.
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    await issueInvoice(orderId);
    const rc = await receivedCase(orderId, [
      { orderItemId: itemIds[0]!, quantity: 1 },
      { orderItemId: itemIds[1]!, quantity: 1 },
    ]);
    const first = rc.items.find((it) => it.orderItemId === itemIds[0])!;

    const res = await settle(rc.id, [{ returnCaseItemId: first.id, approvedRefundAmount: 100 }]);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { totalRefundAmount: number } }).data.totalRefundAmount).toBe(150);

    const refunds = await withSystemScope('test: read the refund', () =>
      h.em().fork().find(Refund, { returnCaseId: rc.id }),
    );
    expect(refunds.map((r) => r.amount)).toEqual(['150.00']);
    const [correction] = await corrections(orderId);
    expect(correction!.total).toBe('150.00');
    expect(correction!.lines.map((l) => l.grossValue).sort()).toEqual(['100.00', '50.00']);
  });

  it('serialises two settlements of one order, so the second reads the first correction', async () => {
    // 2 × 0.03 net at 23 %: 0.06 net, 0.01 VAT, 0.07 charged — issued per rate.
    // The first unit refunds the drop in the kept value, 0.07 − 0.04 = 0.03, and
    // the second the 0.04 kept (issue #435, product-owner ruling Q1 (c)).
    // A second correction that does not see the first credits 0.03 as 0.02 net
    // and 0.01 VAT, and the two together credit 0.02 VAT of the 0.01 invoiced.
    const orderId = await withSystemScope('test: seed a cent order', async () => {
      const em = h.em().fork();
      const order = em.create(Order, {
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: await systemDefaultSalesChannelId(em),
        status: 'completed',
        paymentStatus: 'paid',
        vatMethod: 'per_rate',
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '0.06',
        taxTotal: '0.01',
        deliveryTotal: '0.00',
        discountTotal: '0.00',
        total: '0.07',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      em.create(OrderItem, {
        orderId: order.id,
        productId: randomUUID(),
        productSnapshot: { sku: 'CENT', name: 'Cent', primaryAssetUrl: null },
        quantity: 2,
        unitPrice: '0.03',
        taxRate: '0.2300',
        lineTotal: '0.07',
      });
      em.create(Payment, {
        orderId: order.id,
        paymentMethodId: randomUUID(),
        status: 'paid',
        amount: '0.07',
        currency: 'PLN',
        paidAt: new Date(),
      });
      await em.flush();
      return order.id;
    });
    const orderItemId = await withSystemScope('test: read the line', async () =>
      (await h.em().fork().findOneOrFail(OrderItem, { orderId })).id,
    );
    await issueInvoice(orderId);
    const a = await receivedCase(orderId, [{ orderItemId, quantity: 1 }]);
    const b = await receivedCase(orderId, [{ orderItemId, quantity: 1 }]);

    expect([a, b].map((rc) => rc.items[0]!.defaultRefundAmount)).toEqual([0.03, 0.04]);
    const results = await Promise.all(
      [a, b].map((rc) =>
        settle(
          rc.id,
          rc.items.map((it) => ({ returnCaseItemId: it.id, approvedRefundAmount: it.defaultRefundAmount })),
        ),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);

    const credited = await corrections(orderId);
    expect(credited).toHaveLength(2);
    const sum = (values: ReadonlyArray<string | null | undefined>) => (values.reduce((s, v) => s + Math.round(Number(v ?? 0) * 100), 0) / 100).toFixed(2);
    expect(sum(credited.map((c) => c.total)), 'the two corrections credit what was charged').toBe('0.07');
    expect(sum(credited.map((c) => c.netTotal)), 'and the net that was invoiced').toBe('0.06');
    expect(sum(credited.map((c) => c.taxTotal)), 'and the VAT that was invoiced, not 0.02').toBe('0.01');
  });
});
