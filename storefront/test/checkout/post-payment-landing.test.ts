import { describe, expect, it } from 'vitest';
import {
  PENDING_POLL_INTERVAL_MS,
  PENDING_POLL_MAX_ATTEMPTS,
  checkoutSuccessUrl,
  nextPendingPoll,
  parsePollAttempt,
  paymentFailureUrl,
  parseReturnOutcome,
  paymentReturnUrl,
  resolvePostPaymentLanding,
} from '../../lib/payments/post-payment-landing';

/**
 * Issue #287 — where a buyer lands once the gateway hands them back.
 *
 * The owner's ruling is that a correct payment shows the success page and a
 * failed one the failure page, for every gateway. PayU and Autopay have a
 * single return URL and use it whatever the outcome, so that ruling cannot be
 * expressed in gateway configuration: the platform has to decide after the
 * buyer lands. This is that decision, kept pure so the auth-gated pages do not
 * have to be mounted to exercise it.
 */
describe('resolvePostPaymentLanding', () => {
  it('sends a paid order to the success page whatever the gateway hinted', () => {
    for (const outcome of ['returned', 'cancelled', 'failed', undefined]) {
      expect(
        resolvePostPaymentLanding({ paymentStatus: 'paid', paymentKind: 'gateway', outcome }),
      ).toEqual({ kind: 'success' });
    }
  });

  it('sends a failed payment to the failure page', () => {
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'failed',
        paymentKind: 'gateway',
        outcome: 'returned',
      }),
    ).toEqual({ kind: 'failure', reason: 'failed' });
  });

  it('believes a gateway that reports the attempt failed, before our notification lands', () => {
    // TPay's `errorUrl` is only used for a failed attempt. Trusting it costs
    // nothing: the failure page offers "pay again" and re-reads the order, so a
    // buyer replaying the link after paying is sent on to the success page.
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'awaiting_payment',
        paymentKind: 'gateway',
        outcome: 'failed',
      }),
    ).toEqual({ kind: 'failure', reason: 'failed' });
  });

  it('treats a buyer who backed out of the gateway as a payment not completed', () => {
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'awaiting_payment',
        paymentKind: 'gateway',
        outcome: 'cancelled',
      }),
    ).toEqual({ kind: 'failure', reason: 'cancelled' });
  });

  it('waits, rather than claiming failure, while the confirmation is still in flight', () => {
    // The webhook race: the buyer is back but the gateway's notification is
    // not. Telling them the payment failed is the worst answer available.
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'awaiting_payment',
        paymentKind: 'gateway',
        outcome: 'returned',
      }),
    ).toEqual({ kind: 'pending' });
  });

  it('never waits on a payment that settles out of band', () => {
    // Bank transfer, cash on pickup and a credit-limit draw are arranged
    // outside the checkout session — the order is booked and there is no
    // confirmation coming while the buyer is on the page.
    for (const paymentKind of ['bank_transfer', 'pickup', 'credit_limit']) {
      expect(
        resolvePostPaymentLanding({
          paymentStatus: 'awaiting_payment',
          paymentKind,
          outcome: undefined,
        }),
      ).toEqual({ kind: 'success' });
    }
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'deferred',
        paymentKind: 'credit_limit',
        outcome: undefined,
      }),
    ).toEqual({ kind: 'success' });
  });

  it('does not call a refunded order a failed payment', () => {
    // The money did settle; the refund is a later event and the order page
    // tells that story. Nothing here is a payment the buyer must retry.
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'refunded',
        paymentKind: 'gateway',
        outcome: 'returned',
      }),
    ).toEqual({ kind: 'success' });
  });

  it('waits on an unrecognised payment kind rather than inventing an answer', () => {
    expect(
      resolvePostPaymentLanding({
        paymentStatus: 'awaiting_payment',
        paymentKind: 'something_new',
        outcome: undefined,
      }),
    ).toEqual({ kind: 'pending' });
  });
});

describe('parseReturnOutcome', () => {
  it('keeps the two hints that can bring the failure page forward', () => {
    expect(parseReturnOutcome('cancelled')).toBe('cancelled');
    expect(parseReturnOutcome('failed')).toBe('failed');
  });

  it('reads anything it does not understand as the hint that asserts nothing', () => {
    // A hint only ever moves the buyer towards the failure page, so an absent
    // or hand-edited one must leave the order's own state to decide alone.
    for (const raw of [undefined, '', 'returned', 'paid', 'success', 'FAILED']) {
      expect(parseReturnOutcome(raw)).toBe('returned');
    }
  });
});

describe('post-payment landing URLs', () => {
  const orderId = '11111111-2222-4333-8444-555555555555';

  it('names the success page for a settled order', () => {
    expect(checkoutSuccessUrl(orderId)).toBe(`/checkout/success?id=${orderId}`);
  });

  it('names the failure page with the order, so it can offer to pay that order again', () => {
    expect(paymentFailureUrl(orderId, 'cancelled')).toBe(
      `/checkout/failure?id=${orderId}&outcome=cancelled`,
    );
  });

  it('encodes a hostile order id rather than letting it forge query parameters', () => {
    expect(paymentReturnUrl('a b?x=1&y=2', 'returned')).toBe(
      '/checkout/return?id=a%20b%3Fx%3D1%26y%3D2&outcome=returned',
    );
  });
});

describe('the pending wait', () => {
  const orderId = '11111111-2222-4333-8444-555555555555';

  it('reads the attempt counter, treating anything unusable as the first look', () => {
    expect(parsePollAttempt(undefined)).toBe(0);
    expect(parsePollAttempt('3')).toBe(3);
    expect(parsePollAttempt('-2')).toBe(0);
    expect(parsePollAttempt('not-a-number')).toBe(0);
    expect(parsePollAttempt('999')).toBe(PENDING_POLL_MAX_ATTEMPTS);
  });

  it('schedules the next look at the same landing, one attempt further on', () => {
    expect(nextPendingPoll(orderId, 'returned', 0)).toEqual({
      url: `/checkout/return?id=${orderId}&outcome=returned&attempt=1`,
      delayMs: PENDING_POLL_INTERVAL_MS,
    });
  });

  it('stops looking once the budget is spent, and never turns the wait into a failure', () => {
    expect(nextPendingPoll(orderId, 'returned', PENDING_POLL_MAX_ATTEMPTS)).toBeNull();
  });
});
