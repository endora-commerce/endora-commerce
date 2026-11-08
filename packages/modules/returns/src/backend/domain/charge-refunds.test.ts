import { describe, expect, it } from 'vitest';
import {
  STATUTORY_WITHDRAWAL_DAYS,
  chargeApproved,
  chargeRefunds,
  completesOrder,
  isWithinWithdrawalWindow,
  type ChargeRefundInput,
} from './charge-refunds.js';
import { STATUTORY_WITHDRAWAL_DAYS as STATUTORY_FROM_936 } from './withdrawal-period.js';

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

describe('isWithinWithdrawalWindow — the statutory floor or the channel’s longer window (E2, counted as #936 counts)', () => {
  const TZ = 'Europe/Warsaw';
  // Completed on Monday 2026-06-01, 14:00 in Warsaw. Day 14 is Monday 2026-06-15.
  const completedAt = new Date('2026-06-01T12:00:00.000Z');
  const window = (submittedAt: string, freeReturnEligible = false, completingAt: Date | null = completedAt) =>
    isWithinWithdrawalWindow({ freeReturnEligible, submittedAt: new Date(submittedAt), completingAt, timeZone: TZ });

  it('is the statutory 14 days of withdrawal-period.ts, not a copy', () => {
    expect(STATUTORY_WITHDRAWAL_DAYS).toBe(STATUTORY_FROM_936);
  });

  it('runs to the end of the 14th calendar day in returns.time_zone, even on a channel with free_return_days = 0', () => {
    expect(window('2026-06-15T21:59:59.999Z')).toBe(true); // 23:59:59.999 in Warsaw
    expect(window('2026-06-15T22:00:00.000Z')).toBe(false); // midnight, Tuesday the 16th
  });

  it('counts in the channel’s zone, not the server’s', () => {
    const at = { freeReturnEligible: false, submittedAt: new Date('2026-06-15T23:00:00.000Z'), completingAt: completedAt };
    expect(isWithinWithdrawalWindow({ ...at, timeZone: 'UTC' })).toBe(true);
    expect(isWithinWithdrawalWindow({ ...at, timeZone: 'Europe/Warsaw' })).toBe(false);
  });

  it('a 14th day on a Saturday moves to the Monday', () => {
    // Completed on Saturday 2026-06-06: day 14 is Saturday the 20th, so the period ends on Monday the 22nd.
    const saturday = new Date('2026-06-06T10:00:00.000Z');
    expect(window('2026-06-22T21:00:00.000Z', false, saturday)).toBe(true);
    expect(window('2026-06-22T22:00:00.000Z', false, saturday)).toBe(false);
  });

  it('outside the 14 days only the channel’s free-return window covers it', () => {
    expect(window('2026-07-01T10:00:00.000Z')).toBe(false);
    expect(window('2026-07-01T10:00:00.000Z', true)).toBe(true);
  });

  it('an order not in its completing status has no anchor, so the default does not apply (it never fails open)', () => {
    expect(window('2026-06-02T10:00:00.000Z', false, null)).toBe(false);
  });
});

describe('chargeApproved — what a settlement approves for a charge (ruling Q2 on PR #965)', () => {
  const recomputed = { cap: '15.99', default: '15.99' };

  it('an omitted amount takes the default recomputed under the lock', () => {
    expect(chargeApproved({ recomputed })).toEqual({ approved: '15.99' });
    expect(chargeApproved({ recomputed: { cap: '15.99', default: '0.00' } })).toEqual({ approved: '0.00' });
    expect(chargeApproved({ recomputed: { cap: '0.00', default: '0.00' } })).toEqual({ approved: '0.00' });
  });

  it('a present amount settles exactly, 0 included — never read as "the default approved"', () => {
    expect(chargeApproved({ requested: 0, recomputed })).toEqual({ approved: '0.00' });
    expect(chargeApproved({ requested: '0.00', recomputed })).toEqual({ approved: '0.00' });
    // art. 13(2), a premium delivery reduced to the standard price.
    expect(chargeApproved({ requested: 9.99, recomputed })).toEqual({ approved: '9.99' });
    expect(chargeApproved({ requested: 15.99, recomputed })).toEqual({ approved: '15.99' });
  });

  it('outside the window the operator may raise it to the cap and no further', () => {
    const late = { cap: '15.99', default: '0.00' };
    expect(chargeApproved({ requested: 15.99, recomputed: late })).toEqual({ approved: '15.99' });
    expect(chargeApproved({ requested: 16, recomputed: late })).toEqual({ refused: 'refund_exceeds_paid' });
  });

  it('a present amount above the cap is refused — a stale figure above a cap that shrank to 0 included', () => {
    expect(chargeApproved({ requested: 16, recomputed })).toEqual({ refused: 'refund_exceeds_paid' });
    expect(chargeApproved({ requested: 15.99, recomputed: { cap: '0.00', default: '0.00' } })).toEqual({
      refused: 'refund_exceeds_paid',
    });
    expect(chargeApproved({ requested: 0, recomputed: { cap: '0.00', default: '0.00' } })).toEqual({ approved: '0.00' });
  });
});
