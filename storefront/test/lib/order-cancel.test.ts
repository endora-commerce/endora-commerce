import { describe, expect, it } from 'vitest';
import { offersCancellation } from '../../lib/order-cancel';

/**
 * Feature 085 (FR-018) — the cancel control is offered exactly when the server
 * would accept the cancellation, and the storefront decides none of it.
 *
 * The cases below are the ones a re-derived rule gets wrong. Each carries the
 * order fields a storefront implementation would have reached for, and each
 * asserts that the **capability** is what answers: a shipped bank-transfer
 * order still reads `awaiting_payment` on the money axis, and a freshly placed
 * credit-limit order sits at the same status as every other new order.
 */

describe('offersCancellation', () => {
  it('offers the control when the platform says the buyer may cancel', () => {
    expect(
      offersCancellation({
        customerCancellable: true,
        status: 'on_hold',
        paymentStatus: 'failed',
      } as never),
    ).toBe(true);
  });

  it('does not offer it for a shipped order whose money axis still says unpaid', () => {
    expect(
      offersCancellation({
        customerCancellable: false,
        status: 'shipment_sent',
        paymentStatus: 'awaiting_payment',
      } as never),
    ).toBe(false);
  });

  it('does not offer it for a credit-limit order sitting at the initial status', () => {
    expect(
      offersCancellation({
        customerCancellable: false,
        status: 'new',
        paymentStatus: 'deferred',
      } as never),
    ).toBe(false);
  });

  /**
   * The property that makes this function honest: an order whose fields read
   * like a cancellable one is still refused when the platform says so. A
   * storefront rule of its own would answer `true` here.
   */
  it('follows the capability even when the order fields suggest otherwise', () => {
    expect(
      offersCancellation({
        customerCancellable: false,
        status: 'new',
        paymentStatus: 'awaiting_payment',
      } as never),
    ).toBe(false);
  });

  it('treats a missing capability as no, rather than guessing', () => {
    expect(offersCancellation({ status: 'new', paymentStatus: 'awaiting_payment' } as never)).toBe(
      false,
    );
  });
});
