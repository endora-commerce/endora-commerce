import { describe, expect, it } from 'vitest';
import {
  isBuyerCancellable,
  shopHasNotStarted,
  stillOwedByTheBuyer,
} from '../../../src/modules/orders/domain/customer-cancellation.js';

/**
 * Feature 085 Phase F (FR-013/FR-014/FR-015, research R13) — when a buyer may
 * cancel their own order.
 *
 * The predicate has **two** terms and each of them exists because the other one
 * is not enough:
 *
 * - The money term is an allow-list of two, `awaiting_payment` and `failed`.
 *   Written as `!== 'paid'` it would admit a credit-limit order, which is
 *   unpaid *by arrangement*: the credit was drawn inside the placement
 *   transaction, so the shop is already acting on it.
 * - The lifecycle term is "the order is still where the payment flow left it" —
 *   the graph's initial status, or the status the **payment method's own
 *   `statusOnFailure` setting** points at. Bank transfer and cash on pickup
 *   never advance their money axis on their own, and the admin payment-status
 *   route writes `paymentStatus` alone, so a money-only rule lets a buyer
 *   cancel goods that are already in transit — and under Phase D that
 *   cancellation releases stock the shop has physically dispatched.
 *
 * The second term is deliberately **not** a set test against
 * `{initial, on_hold}`: an order an operator moved to `on_hold` from
 * mid-fulfilment was moved by an actor after the payment flow left it, and the
 * shop had already started on it.
 */

const BANK_TRANSFER_ON_HOLD = { initialStatusCode: 'new', statusOnFailure: 'on_hold' };

describe('stillOwedByTheBuyer — the money term (R13)', () => {
  it('admits the two states in which the buyer still owes the money themselves', () => {
    expect(stillOwedByTheBuyer('awaiting_payment')).toBe(true);
    expect(stillOwedByTheBuyer('failed')).toBe(true);
  });

  it('is an allow-list, not a negation of paid: deferred and refunded are refused', () => {
    // `deferred` is the whole ruling for the credit-limit payment kind: it is
    // literally unpaid and a negation of `paid` would admit it.
    expect(stillOwedByTheBuyer('deferred')).toBe(false);
    expect(stillOwedByTheBuyer('refunded')).toBe(false);
    expect(stillOwedByTheBuyer('paid')).toBe(false);
  });
});

describe('shopHasNotStarted — the lifecycle term (R13)', () => {
  it('accepts the graph initial status, whatever it is called', () => {
    expect(
      shopHasNotStarted({ status: 'awaiting_review', initialStatusCode: 'awaiting_review', statusOnFailure: 'on_hold' }),
    ).toBe(true);
  });

  it('accepts the status the payment method is configured to fail into', () => {
    expect(shopHasNotStarted({ status: 'on_hold', ...BANK_TRANSFER_ON_HOLD })).toBe(true);
  });

  it('compares to the configured failure status, not to "is the order on hold"', () => {
    // The order sits at `on_hold` because an operator put it there from
    // mid-fulfilment; this method fails into `processing`. A set test against
    // `{initial, on_hold}` says yes here, and it is wrong.
    expect(
      shopHasNotStarted({ status: 'on_hold', initialStatusCode: 'new', statusOnFailure: 'processing' }),
    ).toBe(false);
  });

  it('refuses every status the shop moved the order to', () => {
    for (const status of ['processing', 'shipment_ready', 'shipment_sent', 'completed', 'paid']) {
      expect(shopHasNotStarted({ status, ...BANK_TRANSFER_ON_HOLD })).toBe(false);
    }
  });

  it('falls back to the initial status alone when the failure status is unknown', () => {
    // `payment_methods` switched off, or a method deleted since placement: the
    // configured failure status cannot be read, so only the initial status
    // qualifies. The unreadable half fails closed rather than open.
    expect(shopHasNotStarted({ status: 'new', initialStatusCode: 'new', statusOnFailure: null })).toBe(true);
    expect(shopHasNotStarted({ status: 'on_hold', initialStatusCode: 'new', statusOnFailure: null })).toBe(false);
  });
});

describe('isBuyerCancellable — both terms, and the cases that need both', () => {
  it('allows an unpaid order still at the initial status', () => {
    expect(
      isBuyerCancellable({ paymentStatus: 'awaiting_payment', status: 'new', ...BANK_TRANSFER_ON_HOLD }),
    ).toBe(true);
  });

  it('allows an order held after a declined payment — the state this feature creates', () => {
    expect(
      isBuyerCancellable({ paymentStatus: 'failed', status: 'on_hold', ...BANK_TRANSFER_ON_HOLD }),
    ).toBe(true);
  });

  /**
   * The trap, and the reason the lifecycle term exists at all. A money-only
   * predicate passes the case above and fails this one.
   */
  it('refuses a bank-transfer order the shop has already shipped, though the money never arrived', () => {
    expect(
      isBuyerCancellable({
        paymentStatus: 'awaiting_payment',
        status: 'shipment_sent',
        ...BANK_TRANSFER_ON_HOLD,
      }),
    ).toBe(false);
  });

  /**
   * And the reason the money term is an allow-list. A credit-limit order sits
   * at the initial status for as long as any other freshly placed order, so the
   * lifecycle term is *true* for it minutes after placement.
   */
  it('refuses a freshly placed credit-limit order, which both a naive predicate and the second term admit', () => {
    expect(shopHasNotStarted({ status: 'new', ...BANK_TRANSFER_ON_HOLD })).toBe(true);
    expect(
      isBuyerCancellable({ paymentStatus: 'deferred', status: 'new', ...BANK_TRANSFER_ON_HOLD }),
    ).toBe(false);
  });

  it('refuses a paid order at the initial status the operator has not advanced yet', () => {
    expect(isBuyerCancellable({ paymentStatus: 'paid', status: 'new', ...BANK_TRANSFER_ON_HOLD })).toBe(
      false,
    );
  });

  it('refuses a refunded order sitting at the same held status as a failed one', () => {
    expect(
      isBuyerCancellable({ paymentStatus: 'refunded', status: 'on_hold', ...BANK_TRANSFER_ON_HOLD }),
    ).toBe(false);
  });
});
