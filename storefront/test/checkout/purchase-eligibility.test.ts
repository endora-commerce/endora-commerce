import { describe, expect, it } from 'vitest';
import { shouldTrackPurchase } from '../../lib/analytics/purchase-eligibility';

/**
 * Issue #274 — the GA4 `purchase` conversion may not be invented.
 *
 * `/checkout/success` rendered `<PurchaseTracker>` unconditionally, and PayU
 * and Autopay returned every buyer there whatever the outcome, so a declined
 * payment counted as revenue. Repointing those two return URLs stops today's
 * leak; this predicate stops the page from being wrong for the next redirect
 * that lands on it.
 */
describe('shouldTrackPurchase', () => {
  it('fires once a gateway payment is confirmed', () => {
    expect(shouldTrackPurchase({ paymentStatus: 'paid', paymentKind: 'gateway' })).toBe(true);
  });

  it('does not fire for a gateway payment that is still unconfirmed', () => {
    expect(
      shouldTrackPurchase({ paymentStatus: 'awaiting_payment', paymentKind: 'gateway' }),
    ).toBe(false);
  });

  it('does not fire for a failed gateway payment', () => {
    expect(shouldTrackPurchase({ paymentStatus: 'failed', paymentKind: 'gateway' })).toBe(false);
  });

  // Deferred settlement: the buyer never pays online, so waiting for `paid`
  // would drop the conversion entirely rather than delay it. The order is the
  // conversion for these three.
  it('fires for a bank-transfer order that has not been settled yet', () => {
    expect(
      shouldTrackPurchase({ paymentStatus: 'awaiting_payment', paymentKind: 'bank_transfer' }),
    ).toBe(true);
  });

  it('fires for a cash-on-pickup order', () => {
    expect(
      shouldTrackPurchase({ paymentStatus: 'awaiting_payment', paymentKind: 'pickup' }),
    ).toBe(true);
  });

  it('fires for a credit-limit order, whose payment status is `deferred`', () => {
    expect(
      shouldTrackPurchase({ paymentStatus: 'deferred', paymentKind: 'credit_limit' }),
    ).toBe(true);
  });

  it('does not fire for an order that has already been refunded', () => {
    expect(shouldTrackPurchase({ paymentStatus: 'refunded', paymentKind: 'bank_transfer' })).toBe(
      false,
    );
    expect(shouldTrackPurchase({ paymentStatus: 'refunded', paymentKind: 'gateway' })).toBe(false);
  });

  it('requires confirmation for a payment kind outside the known enum', () => {
    // `PaymentMethodKind` is a closed contract; an unrecognised value is a
    // surprise, and the safe answer to a surprise is not to invent revenue.
    expect(
      shouldTrackPurchase({ paymentStatus: 'awaiting_payment', paymentKind: 'crypto' }),
    ).toBe(false);
    expect(shouldTrackPurchase({ paymentStatus: 'paid', paymentKind: 'crypto' })).toBe(true);
  });
});
