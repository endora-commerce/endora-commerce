import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../lib/api/orders';

/**
 * Issue #277 — a gateway buyer's GA4 `purchase` conversion.
 *
 * Issue #274 repointed PayU, Autopay, the Stripe cancel and the TPay failure
 * from `/checkout/*` to `/orders/:id`, which is right — a buyer whose order
 * already exists must not be returned to a placement surface — but that page
 * rendered no tracker, so every PayU and Autopay conversion stopped being
 * reported at all.
 *
 * `<PurchaseTracker>` renders `null`, so the page render alone cannot say
 * whether a conversion was reported. It is replaced here by a marker element,
 * which makes the page's decision — *this* order, with *this* payload —
 * observable, and the report itself is exercised through the same
 * `reportPurchaseOnce` rule the tracker uses, against a fake of the platform's
 * claim.
 */

const order: OrderSummary = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'ORD-2001-2026',
  organizationId: 'org-1',
  status: 'new',
  paymentStatus: 'paid',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'courier', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'payu_pbl', name: {}, kind: 'gateway' },
  items: [
    {
      id: 'i1',
      productId: 'prod-1',
      variantId: null,
      quantity: 2,
      unitPrice: 50,
      taxRate: 23,
      lineTotal: 100,
      productSnapshot: { sku: 'SKU-1', name: 'Widget', primaryAssetUrl: null },
      variantSnapshot: null,
    },
  ],
  subtotal: 100,
  taxTotal: 23,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 123,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-08-21T10:00:00.000Z',
  nextAction: null,
};

let currentOrder: OrderSummary = order;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en' }),
}));
vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>(
    '../../lib/api/orders',
  );
  return {
    ...actual,
    getMyOrder: async () => currentOrder,
    listOrderComments: async () => [],
    addOrderComment: async () => undefined,
    cancelMyOrder: async () => currentOrder,
    cloneOrderToQuote: async () => ({ quoteRequestId: 'q1' }),
    reorderOrder: async () => ({ cartId: 'c1', checkoutUrl: '/cart', unavailableItems: [] }),
  };
});
vi.mock('../../lib/api/returns', () => ({ getReturnable: async () => ({ eligible: false }) }));
vi.mock('../../lib/api/invoices', () => ({
  listMyOrderInvoices: async () => [],
  invoiceDownloadUrl: () => '#',
}));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));

vi.mock('../../components/analytics/EcommerceTrackers', () => ({
  PurchaseTracker: ({ order: payload, orderId }: { order: { transactionId: string; value: number }; orderId: string }) => (
    <span data-purchase-tracker={orderId} data-transaction={payload.transactionId} data-value={payload.value} />
  ),
}));

async function renderOrderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: OrderConfirmationPage } = await import('../../app/(account)/orders/[id]/page');
  const element = await OrderConfirmationPage({
    params: Promise.resolve({ id: order.id }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToString(element as React.ReactElement);
}

describe('order page — GA4 purchase conversion (issue #277)', () => {
  beforeEach(() => {
    currentOrder = order;
  });

  it('reports the conversion once for a gateway buyer returning from the gateway, and never again', async () => {
    const { reportPurchaseOnce } = await import('../../lib/analytics/purchase-conversion');
    // The platform's claim, opened when the order was placed.
    const open = new Set([order.id]);
    const claim = async (id: string) => open.delete(id);
    const fired: string[] = [];
    const fire = (payload: { transactionId: string }) => fired.push(payload.transactionId);

    // The buyer comes back from PayU: `?payment=returned`, payment confirmed.
    const first = await renderOrderPage({ payment: 'returned' });
    const firstMatch = first.match(/data-purchase-tracker="([^"]+)"/);
    expect(firstMatch?.[1]).toBe(order.id);
    expect(first).toContain('data-transaction="ORD-2001-2026"');
    expect(first).toContain('data-value="123"');
    await reportPurchaseOnce({
      orderId: order.id,
      payload: { transactionId: order.businessId, value: 123, currency: 'PLN', items: [] },
      claim,
      fire,
    });
    expect(fired).toEqual(['ORD-2001-2026']);

    // They open the same order again — from their list, a bookmark, a phone.
    const second = await renderOrderPage();
    expect(second).toContain('data-purchase-tracker=');
    await reportPurchaseOnce({
      orderId: order.id,
      payload: { transactionId: order.businessId, value: 123, currency: 'PLN', items: [] },
      claim,
      fire,
    });
    expect(fired).toEqual(['ORD-2001-2026']);
  });

  it('renders no tracker for a refunded order', async () => {
    currentOrder = { ...order, paymentStatus: 'refunded' };
    expect(await renderOrderPage({ payment: 'returned' })).not.toContain('data-purchase-tracker');
  });

  it('renders no tracker for a gateway payment that failed', async () => {
    currentOrder = { ...order, paymentStatus: 'failed' };
    expect(await renderOrderPage({ payment: 'failed' })).not.toContain('data-purchase-tracker');
  });

  it('renders no tracker for a gateway payment that has not been confirmed yet', async () => {
    currentOrder = { ...order, paymentStatus: 'awaiting_payment' };
    expect(await renderOrderPage({ payment: 'returned' })).not.toContain('data-purchase-tracker');
  });

  it('renders the tracker for a bank-transfer order that has not cleared', async () => {
    // The deferred case a naive `paid` check drops: the money arrives days
    // later, so waiting for it would not delay the conversion, it would lose it.
    currentOrder = {
      ...order,
      paymentStatus: 'awaiting_payment',
      paymentMethod: { id: 'p2', code: 'bank_transfer', name: {}, kind: 'bank_transfer' },
    };
    expect(await renderOrderPage()).toContain('data-transaction="ORD-2001-2026"');
  });
});
