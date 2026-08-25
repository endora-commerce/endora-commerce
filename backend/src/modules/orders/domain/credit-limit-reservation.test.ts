import { describe, expect, it } from 'vitest';
import { mayHoldCreditLimitReservation } from './credit-limit-reservation.js';

/**
 * The predicate that decides whether `orders` asks `credit_limits` anything at
 * all (D-179.3). Its `false` answers are the ones that matter: each is a
 * cross-module call that is not made, and therefore a gated port that cannot
 * refuse a transition for an order that never drew credit.
 *
 * The end-to-end proof — with `credit_limits` genuinely switched off, an
 * ordinary order still cancels and still marks paid, and one holding a
 * reservation still refuses — is
 * `test/integration/orders/credit-release-scoped-to-credit-limit-orders.test.ts`.
 */
describe('mayHoldCreditLimitReservation', () => {
  it('is true for an order placed against a credit limit', () => {
    expect(
      mayHoldCreditLimitReservation({ paymentMethodSnapshot: { kind: 'credit_limit' } }),
    ).toBe(true);
  });

  it('is false for every other payment-method kind', () => {
    for (const kind of ['bank_transfer', 'pickup', 'gateway']) {
      expect(mayHoldCreditLimitReservation({ paymentMethodSnapshot: { kind } })).toBe(false);
    }
  });

  it('is false for an order whose snapshot is missing or kindless', () => {
    expect(mayHoldCreditLimitReservation({ paymentMethodSnapshot: null })).toBe(false);
    expect(mayHoldCreditLimitReservation({})).toBe(false);
    expect(mayHoldCreditLimitReservation({ paymentMethodSnapshot: {} })).toBe(false);
  });
});
