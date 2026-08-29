import { describe, expect, it } from 'vitest';
import { purchaseTrackingPayload } from '../../lib/analytics/purchase-eligibility';
import type { OrderSummary } from '../../lib/api/orders';

/**
 * Issue #274 — the one guard the checkout Success Page applies before it
 * renders `<PurchaseTracker>`. `<PurchaseTracker>` renders `null`, so the
 * decision cannot be observed through `renderToString`; it is exercised here
 * at the seam the page actually calls.
 *
 * Deleting the guard inside `purchaseTrackingPayload` reddens this file and
 * nothing else.
 */
function order(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    businessId: 'ORD-1042-2026',
    organizationId: 'org-1',
    status: 'new',
    paymentStatus: 'awaiting_payment',
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
    placedAt: '2026-08-20T10:00:00.000Z',
    nextAction: null,
    ...overrides,
  };
}

describe('checkout Success Page — purchase tracker guard', () => {
  it('renders no purchase tracker for a gateway order whose payment is unconfirmed', () => {
    expect(purchaseTrackingPayload(order())).toBeNull();
  });

  it('renders the tracker with the order totals once the gateway payment lands', () => {
    expect(purchaseTrackingPayload(order({ paymentStatus: 'paid' }))).toEqual({
      transactionId: 'ORD-1042-2026',
      value: 123,
      currency: 'PLN',
      items: [{ sku: 'SKU-1', name: 'Widget', price: 50, quantity: 2, currency: 'PLN' }],
    });
  });

  it('renders the tracker for a bank-transfer order that is not settled yet', () => {
    const payload = purchaseTrackingPayload(
      order({ paymentMethod: { id: 'p2', code: 'bank_transfer', name: {}, kind: 'bank_transfer' } }),
    );
    expect(payload?.transactionId).toBe('ORD-1042-2026');
  });
});
