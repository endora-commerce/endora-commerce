import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrderSummary } from '../../lib/api/orders';

/**
 * Issue #277 — `/checkout/success` still counts the buyers who still land on
 * it, and counts them once.
 *
 * Issue #274 moved the *redirect* returns to `/orders/:id`, and left this page
 * with everything else: an offline placement (bank transfer, cash on pickup,
 * credit limit), Stripe's `success_url`, TPay's `successUrl`, and every inline
 * `/checkout/pay` form — PayU, TPay and Stripe — that succeeds. Adding the
 * tracker to the order page must not take the tracker off this one, and must
 * not let an order be counted on both.
 */

const order: OrderSummary = {
  id: '99999999-2222-4333-8444-555555555555',
  businessId: 'ORD-4001-2026',
  organizationId: 'org-1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: {},
  billingAddress: {},
  deliveryMethod: { id: 'd1', code: 'pickup', name: {}, cost: 0 },
  paymentMethod: { id: 'p1', code: 'bank_transfer', name: {}, kind: 'bank_transfer' },
  items: [
    {
      id: 'i1',
      productId: 'prod-1',
      variantId: null,
      quantity: 1,
      unitPrice: 200,
      taxRate: 23,
      lineTotal: 200,
      productSnapshot: { sku: 'SKU-9', name: 'Pallet', primaryAssetUrl: null },
      variantSnapshot: null,
    },
  ],
  subtotal: 200,
  taxTotal: 46,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 246,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-08-21T10:00:00.000Z',
  nextAction: null,
};

let currentOrder: OrderSummary = order;

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en' }),
}));
vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>(
    '../../lib/api/orders',
  );
  return { ...actual, getMyOrder: async () => currentOrder };
});
vi.mock('../../components/analytics/EcommerceTrackers', () => ({
  PurchaseTracker: ({
    order: payload,
    orderId,
  }: {
    order: { transactionId: string };
    orderId: string;
  }) => <span data-purchase-tracker={orderId} data-transaction={payload.transactionId} />,
}));

async function renderSuccessPage(): Promise<string> {
  const { default: CheckoutSuccessPage } = await import(
    '../../app/(commerce)/checkout/success/page'
  );
  const element = await CheckoutSuccessPage({
    searchParams: Promise.resolve({ id: order.id }),
  });
  return renderToString(element as React.ReactElement);
}

describe('checkout success page — GA4 purchase conversion (issue #277)', () => {
  beforeEach(() => {
    currentOrder = order;
  });

  it('still counts an offline placement, and names the order the claim is keyed on', async () => {
    const html = await renderSuccessPage();
    expect(html).toContain(`data-purchase-tracker="${order.id}"`);
    expect(html).toContain('data-transaction="ORD-4001-2026"');
  });

  it('still counts a Stripe or TPay success once the payment is confirmed', async () => {
    currentOrder = {
      ...order,
      paymentStatus: 'paid',
      paymentMethod: { id: 'p3', code: 'stripe_card', name: {}, kind: 'gateway' },
    };
    expect(await renderSuccessPage()).toContain('data-transaction="ORD-4001-2026"');
  });

  it('still refuses a gateway order whose payment is unconfirmed', async () => {
    currentOrder = {
      ...order,
      paymentStatus: 'awaiting_payment',
      paymentMethod: { id: 'p3', code: 'stripe_card', name: {}, kind: 'gateway' },
    };
    expect(await renderSuccessPage()).not.toContain('data-purchase-tracker');
  });
});
