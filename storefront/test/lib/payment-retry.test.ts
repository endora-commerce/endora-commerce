import { describe, expect, it } from 'vitest';
import { offersPaymentRetry, paymentRetryDestination } from '../../lib/payment-retry';
import type { PaymentRetryResult } from '../../lib/api/payments';

/**
 * The buyer's "pay again" routing (issue #264).
 *
 * Two rules, and the first is the one that was actually missing. The order page
 * already knew an order was `awaiting_payment` and said so — "This order is
 * awaiting payment. Complete payment to proceed." — with no way to proceed, and
 * hid even that sentence once the order looked terminal. Every payment method
 * in the tree was then seeded `status_on_failure = 'cancelled'`, so a declined
 * card produced exactly that: a cancelled-looking order the buyer still owed
 * money on, with no control anywhere.
 *
 * Feature 085 changed both halves of that sentence — the shipped default is
 * `on_hold`, and a decline is recorded on the money axis as
 * `paymentStatus = 'failed'` — which is why the first case below is now
 * `failed` rather than a footnote. A predicate left at `=== 'awaiting_payment'`
 * would hide the control from every buyer whose card was actually declined,
 * which is the whole population it was built for.
 */

const result = (over: Partial<PaymentRetryResult> = {}): PaymentRetryResult => ({
  paymentId: 'p1',
  attemptNo: 2,
  opened: true,
  nextAction: { kind: 'none' },
  ...over,
});

describe('offersPaymentRetry', () => {
  /**
   * The buyer this control exists for: their card was declined, the ingress
   * wrote `failed`, and the order is sitting at the method's failure status
   * waiting for them. If this is red the "Pay again" button is invisible to
   * every declined buyer on every gateway.
   */
  it('offers a retry on a gateway order whose payment failed', () => {
    expect(
      offersPaymentRetry({ paymentStatus: 'failed', paymentMethod: { kind: 'gateway' } }),
    ).toBe(true);
  });

  it('offers a retry on a gateway order that is still awaiting payment', () => {
    expect(
      offersPaymentRetry({ paymentStatus: 'awaiting_payment', paymentMethod: { kind: 'gateway' } }),
    ).toBe(true);
  });

  it('offers nothing once the order is paid', () => {
    expect(
      offersPaymentRetry({ paymentStatus: 'paid', paymentMethod: { kind: 'gateway' } }),
    ).toBe(false);
  });

  /**
   * The money term is an allow-list of two, not a negation of `paid`. A
   * credit-limit order is `deferred` — unpaid, and drawn against the buyer's
   * limit inside the placement transaction, so the shop is already acting on
   * it — and a `refunded` order is settled in the other direction. A negation
   * would offer both a payment session that does not exist.
   */
  it('offers nothing for a payment settled by arrangement or reversed', () => {
    for (const paymentStatus of ['deferred', 'refunded']) {
      expect(offersPaymentRetry({ paymentStatus, paymentMethod: { kind: 'gateway' } })).toBe(false);
    }
  });

  /**
   * The three offline kinds are `awaiting_payment` too, and for none of them is
   * there a session the buyer can open: a transfer and a cash-on-delivery order
   * settle out of band, and a credit-limit order is already drawn.
   */
  it('offers nothing for a method the buyer cannot pay online', () => {
    for (const kind of ['bank_transfer', 'pickup', 'credit_limit']) {
      for (const paymentStatus of ['awaiting_payment', 'failed']) {
        expect(offersPaymentRetry({ paymentStatus, paymentMethod: { kind } })).toBe(false);
      }
    }
  });
});

describe('paymentRetryDestination', () => {
  it('sends the buyer to the gateway when the adapter returned one', () => {
    const target = paymentRetryDestination(
      'o1',
      result({ nextAction: { kind: 'redirect', url: 'https://psp.example/pay' } }),
      'autopay_pbl',
    );
    expect(target).toBe('https://psp.example/pay');
  });

  it('sends an inline gateway to this platform`s own payment step', () => {
    expect(paymentRetryDestination('o1', result(), 'stripe_card')).toBe('/checkout/pay?id=o1');
    expect(paymentRetryDestination('o1', result(), 'tpay_blik')).toBe(
      '/checkout/pay?id=o1&gateway=tpay',
    );
    expect(paymentRetryDestination('o1', result(), 'payu_card')).toBe(
      '/checkout/pay?id=o1&gateway=payu',
    );
    expect(paymentRetryDestination('o1', result(), 'paypal_checkout')).toBe(
      '/checkout/pay?id=o1&gateway=paypal',
    );
  });

  /**
   * A resumed attempt has no new provider session, so the buyer goes to the
   * payment step for the one that is already running — the gateway module's own
   * form reads its existing mapping there. It is the *`redirect` absence* that
   * decides this, not `opened`, which is why the two are asserted apart.
   */
  it('routes a resumed attempt to the same inline step', () => {
    expect(paymentRetryDestination('o1', result({ opened: false }), 'payu_blik')).toBe(
      '/checkout/pay?id=o1&gateway=payu',
    );
  });

  /**
   * A redirect-only gateway that gave us nothing has nowhere to send the buyer.
   * `null` is the page's cue to say so rather than navigate somewhere useless —
   * `/checkout/pay` renders no form for Autopay.
   */
  it('has no destination for a redirect-only gateway with no URL', () => {
    expect(paymentRetryDestination('o1', result({ opened: false }), 'autopay_pbl')).toBeNull();
  });

  it('escapes the order id it puts in the query', () => {
    expect(paymentRetryDestination('o 1&x', result(), 'stripe_card')).toBe(
      '/checkout/pay?id=o%201%26x',
    );
  });
});
