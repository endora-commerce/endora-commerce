import { describe, expect, it } from 'vitest';
import {
  isBuyerCancellable,
  shopHasNotStarted,
  stillOwedByTheBuyer,
} from '../../../../packages/modules/orders/src/backend/domain/customer-cancellation.js';

/**
 * Feature 085 Phase F (FR-013/FR-014/FR-015, research R13) — when a buyer may
 * cancel their own order — as the owner's ruling on issue #284 leaves it.
 *
 * The predicate has **two** terms and each of them exists because the other one
 * is not enough:
 *
 * - The money term is an allow-list of two, `awaiting_payment` and `failed`.
 *   Written as `!== 'paid'` it would admit a credit-limit order, which is
 *   unpaid *by arrangement*: the credit was drawn inside the placement
 *   transaction, so the shop is already acting on it.
 * - The lifecycle term is "nobody has begun to fulfil the order": the graph's
 *   initial status, or the status the payment method fails into **with the
 *   settlement ingress as the author of that status**. Bank transfer and cash
 *   on pickup never advance their money axis on their own, and the admin
 *   payment-status route writes `paymentStatus` alone, so a money-only rule
 *   lets a buyer cancel goods already in transit — and under Phase D that
 *   cancellation releases stock the shop has physically dispatched.
 *
 * ## The third input, and what it is doing here
 *
 * The lifecycle term used to be the status comparison alone, and R13 claimed
 * that told an order held by a decline apart from one an operator held
 * mid-fulfilment. It does — **whenever the two statuses differ**, which under
 * the shipped default they do not: Phase C points every method's
 * `status_on_failure` at `on_hold`, and on that configuration the two orders
 * agree in every column. `currentStatusWrittenBySystem` is the fact that does
 * separate them, established from the transition history Phase D began writing.
 *
 * Every case below that turns on it is therefore written on
 * `statusOnFailure: 'on_hold'` with `status: 'on_hold'` — the configuration
 * where the columns cannot decide.
 */

const BANK_TRANSFER_ON_HOLD = { initialStatusCode: 'new', statusOnFailure: 'on_hold' };
/** The author of a status a decline wrote. */
const HELD_BY_THE_INGRESS = { currentStatusWrittenBySystem: true };
/** The author of a status an operator (or the customer) wrote, and of no author at all. */
const HELD_BY_AN_ACTOR = { currentStatusWrittenBySystem: false };

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

describe('shopHasNotStarted — the lifecycle term (R13, #284)', () => {
  it('accepts the graph initial status, whatever it is called', () => {
    expect(
      shopHasNotStarted({
        status: 'awaiting_review',
        initialStatusCode: 'awaiting_review',
        statusOnFailure: 'on_hold',
        ...HELD_BY_AN_ACTOR,
      }),
    ).toBe(true);
  });

  it('does not ask who wrote the initial status: nobody did', () => {
    // A freshly placed order has no transition entry at all, and needing one
    // would refuse every buyer their ordinary cancellation.
    expect(shopHasNotStarted({ status: 'new', ...BANK_TRANSFER_ON_HOLD, ...HELD_BY_AN_ACTOR })).toBe(
      true,
    );
  });

  it('accepts the configured failure status when the settlement ingress put the order there', () => {
    expect(
      shopHasNotStarted({ status: 'on_hold', ...BANK_TRANSFER_ON_HOLD, ...HELD_BY_THE_INGRESS }),
    ).toBe(true);
  });

  /**
   * Issue #284, and the case the previous formulation could not decide. Same
   * status, same configured failure status — an operator wrote this one.
   */
  it('refuses the same status on the same method when an actor wrote it', () => {
    expect(
      shopHasNotStarted({ status: 'on_hold', ...BANK_TRANSFER_ON_HOLD, ...HELD_BY_AN_ACTOR }),
    ).toBe(false);
  });

  it('still compares to the configured failure status, not to "is the order on hold"', () => {
    // This method fails into `processing`, so `on_hold` is not where a decline
    // would have left the order — whoever wrote it. Authorship alone would
    // admit a system-written `shipment_sent` too, which is the same hazard
    // wearing the other hat.
    expect(
      shopHasNotStarted({
        status: 'on_hold',
        initialStatusCode: 'new',
        statusOnFailure: 'processing',
        ...HELD_BY_THE_INGRESS,
      }),
    ).toBe(false);
    expect(
      shopHasNotStarted({
        status: 'shipment_sent',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_THE_INGRESS,
      }),
    ).toBe(false);
  });

  it('refuses every status the shop moved the order to', () => {
    for (const status of ['processing', 'shipment_ready', 'shipment_sent', 'completed', 'paid']) {
      expect(shopHasNotStarted({ status, ...BANK_TRANSFER_ON_HOLD, ...HELD_BY_THE_INGRESS })).toBe(
        false,
      );
    }
  });

  it('falls back to the initial status alone when the failure status is unknown', () => {
    // `payment_methods` switched off, or a method deleted since placement: the
    // configured failure status cannot be read, so only the initial status
    // qualifies. The unreadable half fails closed rather than open, and a
    // system author does not rescue it.
    expect(
      shopHasNotStarted({
        status: 'new',
        initialStatusCode: 'new',
        statusOnFailure: null,
        ...HELD_BY_AN_ACTOR,
      }),
    ).toBe(true);
    expect(
      shopHasNotStarted({
        status: 'on_hold',
        initialStatusCode: 'new',
        statusOnFailure: null,
        ...HELD_BY_THE_INGRESS,
      }),
    ).toBe(false);
  });
});

describe('isBuyerCancellable — both terms, and the cases that need both', () => {
  it('allows an unpaid order still at the initial status', () => {
    expect(
      isBuyerCancellable({
        paymentStatus: 'awaiting_payment',
        status: 'new',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_AN_ACTOR,
      }),
    ).toBe(true);
  });

  it('allows an order held after a declined payment — the state this feature creates', () => {
    expect(
      isBuyerCancellable({
        paymentStatus: 'failed',
        status: 'on_hold',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_THE_INGRESS,
      }),
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
        ...HELD_BY_THE_INGRESS,
      }),
    ).toBe(false);
  });

  /**
   * Issue #284's live case, in the one configuration that reaches it. Every
   * column agrees with the case two tests above — the money axis says the
   * transfer never arrived, the status is the method's own failure status —
   * and an operator wrote the hold to investigate something mid-fulfilment.
   */
  it('refuses an operator hold that is column-for-column identical to a decline hold', () => {
    const decline = {
      paymentStatus: 'awaiting_payment',
      status: 'on_hold',
      ...BANK_TRANSFER_ON_HOLD,
    };
    expect(isBuyerCancellable({ ...decline, ...HELD_BY_THE_INGRESS })).toBe(true);
    expect(isBuyerCancellable({ ...decline, ...HELD_BY_AN_ACTOR })).toBe(false);
  });

  /**
   * And the reason the money term is an allow-list. A credit-limit order sits
   * at the initial status for as long as any other freshly placed order, so the
   * lifecycle term is *true* for it minutes after placement.
   */
  it('refuses a freshly placed credit-limit order, which both a naive predicate and the second term admit', () => {
    expect(shopHasNotStarted({ status: 'new', ...BANK_TRANSFER_ON_HOLD, ...HELD_BY_AN_ACTOR })).toBe(
      true,
    );
    expect(
      isBuyerCancellable({
        paymentStatus: 'deferred',
        status: 'new',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_AN_ACTOR,
      }),
    ).toBe(false);
  });

  it('refuses a paid order at the initial status the operator has not advanced yet', () => {
    expect(
      isBuyerCancellable({
        paymentStatus: 'paid',
        status: 'new',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_AN_ACTOR,
      }),
    ).toBe(false);
  });

  it('refuses a refunded order sitting at the same held status as a failed one', () => {
    expect(
      isBuyerCancellable({
        paymentStatus: 'refunded',
        status: 'on_hold',
        ...BANK_TRANSFER_ON_HOLD,
        ...HELD_BY_THE_INGRESS,
      }),
    ).toBe(false);
  });
});
