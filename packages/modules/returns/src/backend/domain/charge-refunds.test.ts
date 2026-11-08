import { describe, expect, it } from 'vitest';
import {
  STATUTORY_WITHDRAWAL_DAYS,
  chargeApproved,
  chargeRefunds,
  completesOrder,
  isWithinWithdrawalWindow,
  type ChargeRefundInput,
} from './charge-refunds.js';

/**
 * Issue #876 — a consumer's withdrawal from the whole sale refunds the delivery
 * cost and the payment surcharge (Directive 2011/83 art. 13(1), PL art. 32
 * ust. 1: "all payments received, including delivery costs"). Owner rulings of
 * 2026-11-07: E1 — a partial withdrawal refunds neither, the case that completes
 * the withdrawal refunds both; E2 — the default applies within the statutory 14
 * days or the channel's longer free-return window; E3 — the surcharge is
 * included.
 */
const inScope: ChargeRefundInput = {
  isPersonal: true,
  kind: 'return',
  completes: true,
  withinWindow: true,
  paid: { delivery: '15.99', surcharge: '2.50' },
  refundedBefore: { delivery: '0.00', surcharge: '0.00' },
};

describe('chargeRefunds — the four conditions (#876)', () => {
  it('a consumer withdrawal that completes the order, within the window, defaults to the whole delivery and surcharge', () => {
    expect(chargeRefunds(inScope)).toEqual({
      delivery: { cap: '15.99', default: '15.99' },
      surcharge: { cap: '2.50', default: '2.50' },
    });
  });

  it('a business customer gets nothing: a B2B return is not a statutory withdrawal', () => {
    expect(chargeRefunds({ ...inScope, isPersonal: false })).toEqual({
      delivery: { cap: '0.00', default: '0.00' },
      surcharge: { cap: '0.00', default: '0.00' },
    });
  });

  it('a complaint gets nothing: it is not a withdrawal', () => {
    expect(chargeRefunds({ ...inScope, kind: 'complaint' })).toEqual({
      delivery: { cap: '0.00', default: '0.00' },
      surcharge: { cap: '0.00', default: '0.00' },
    });
  });

  it('E1 — a partial withdrawal gets nothing, and the operator cannot add it', () => {
    expect(chargeRefunds({ ...inScope, completes: false })).toEqual({
      delivery: { cap: '0.00', default: '0.00' },
      surcharge: { cap: '0.00', default: '0.00' },
    });
  });

  it('E2 — outside the window the default is 0, and the operator may still refund up to what was paid', () => {
    expect(chargeRefunds({ ...inScope, withinWindow: false })).toEqual({
      delivery: { cap: '15.99', default: '0.00' },
      surcharge: { cap: '2.50', default: '0.00' },
    });
  });

  it('takes off what an earlier case already refunded, and never goes below 0', () => {
    expect(
      chargeRefunds({ ...inScope, refundedBefore: { delivery: '10.00', surcharge: '3.00' } }),
    ).toEqual({
      delivery: { cap: '5.99', default: '5.99' },
      surcharge: { cap: '0.00', default: '0.00' },
    });
  });

  it('an order without a delivery cost or a surcharge refunds none', () => {
    expect(chargeRefunds({ ...inScope, paid: { delivery: '0.00', surcharge: '0.00' } })).toEqual({
      delivery: { cap: '0.00', default: '0.00' },
      surcharge: { cap: '0.00', default: '0.00' },
    });
  });
});

describe('completesOrder — every unit of every line back in the kept state, this case included', () => {
  const lines = [
    { orderItemId: 'a', purchasedQty: 2 },
    { orderItemId: 'b', purchasedQty: 1 },
  ];

  it('one case returning everything completes', () => {
    expect(completesOrder(lines, [], [{ orderItemId: 'a', quantity: 2 }, { orderItemId: 'b', quantity: 1 }])).toBe(true);
  });

  it('the case returning the rest completes; the earlier partial case did not', () => {
    expect(completesOrder(lines, [], [{ orderItemId: 'a', quantity: 1 }])).toBe(false);
    expect(
      completesOrder(lines, [{ orderItemId: 'a', quantity: 1 }], [{ orderItemId: 'a', quantity: 1 }, { orderItemId: 'b', quantity: 1 }]),
    ).toBe(true);
  });

  it('a line nobody returned keeps the order incomplete — so a non-returnable line never lets it complete', () => {
    expect(completesOrder(lines, [], [{ orderItemId: 'a', quantity: 2 }])).toBe(false);
  });

  it('an order with no lines is never completed by a case', () => {
    expect(completesOrder([], [], [])).toBe(false);
  });
});

describe('isWithinWithdrawalWindow — the statutory floor or the channel’s longer window (E2)', () => {
  const completedAt = new Date('2026-06-01T12:00:00.000Z');
  const day = (n: number) => new Date(completedAt.getTime() + n * 24 * 60 * 60 * 1000);

  it('is 14 days', () => {
    expect(STATUTORY_WITHDRAWAL_DAYS).toBe(14);
  });

  it('a case opened within 14 days is within it, even on a channel with free_return_days = 0', () => {
    expect(isWithinWithdrawalWindow({ freeReturnEligible: false, submittedAt: day(14), completingAt: completedAt })).toBe(true);
  });

  it('a case opened after 14 days is outside it, unless the channel’s free-return window covered it', () => {
    const late = new Date(day(14).getTime() + 1);
    expect(isWithinWithdrawalWindow({ freeReturnEligible: false, submittedAt: late, completingAt: completedAt })).toBe(false);
    expect(isWithinWithdrawalWindow({ freeReturnEligible: true, submittedAt: day(30), completingAt: completedAt })).toBe(true);
  });

  it('an order not in its completing status has no statutory anchor', () => {
    expect(isWithinWithdrawalWindow({ freeReturnEligible: false, submittedAt: completedAt, completingAt: null })).toBe(false);
  });
});

describe('chargeApproved — what a settlement approves for a charge', () => {
  const recomputed = { cap: '15.99', default: '15.99' };

  it('an amount equal to the stored or the recomputed default is the default approved', () => {
    expect(chargeApproved({ requested: 15.99, previousDefault: '15.99', recomputed })).toEqual({ approved: '15.99' });
    // A case created partial (default 0) that completes at settlement: the stored 0 is the default.
    expect(chargeApproved({ requested: '0.00', previousDefault: '0.00', recomputed })).toEqual({ approved: '15.99' });
    // A case created completing that no longer completes: the stored default follows the recompute.
    expect(
      chargeApproved({ requested: '15.99', previousDefault: '15.99', recomputed: { cap: '0.00', default: '0.00' } }),
    ).toEqual({ approved: '0.00' });
  });

  it('a lower amount is the operator’s — art. 13(2), a premium delivery reduced to the standard price', () => {
    expect(chargeApproved({ requested: 0, previousDefault: '15.99', recomputed })).toEqual({ approved: '0.00' });
    expect(chargeApproved({ requested: 9.99, previousDefault: '15.99', recomputed })).toEqual({ approved: '9.99' });
  });

  it('outside the window the operator may raise it to the cap and no further', () => {
    const late = { cap: '15.99', default: '0.00' };
    expect(chargeApproved({ requested: 15.99, previousDefault: '0.00', recomputed: late })).toEqual({ approved: '15.99' });
    expect(chargeApproved({ requested: 16, previousDefault: '0.00', recomputed: late })).toEqual({
      refused: 'refund_exceeds_paid',
    });
  });

  it('more than was paid is refused', () => {
    expect(chargeApproved({ requested: 16, previousDefault: '15.99', recomputed })).toEqual({ refused: 'refund_exceeds_paid' });
  });
});
