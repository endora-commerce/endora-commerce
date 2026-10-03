import { describe, expect, it } from 'vitest';
import {
  effectsOwedByPaymentStatusChange,
  effectsOwedByStatusTransition,
  ownerOfEffect,
} from './transition-effects.js';

/**
 * Which follow-ups a transition owes (`specs/142-order-transition-atomicity/`,
 * plan table *Which rows a transition writes*).
 */

const onCredit = { paymentMethodSnapshot: { kind: 'credit_limit' } };
const onTransfer = { paymentMethodSnapshot: { kind: 'bank_transfer' } };

describe('effectsOwedByStatusTransition', () => {
  it('a cancelled credit order owes the stock release and the credit release', () => {
    expect(effectsOwedByStatusTransition(onCredit, 'cancelled')).toEqual([
      { effect: 'stock.release', reason: 'order_cancelled' },
      { effect: 'credit.release', reason: 'order_cancelled' },
    ]);
  });

  it('any other cancelled order owes the stock release alone', () => {
    expect(effectsOwedByStatusTransition(onTransfer, 'cancelled')).toEqual([
      { effect: 'stock.release', reason: 'order_cancelled' },
    ]);
    expect(effectsOwedByStatusTransition({ paymentMethodSnapshot: null }, 'cancelled')).toEqual([
      { effect: 'stock.release', reason: 'order_cancelled' },
    ]);
  });

  it('every other lifecycle transition owes nothing — the lifecycle status `paid` included', () => {
    for (const to of ['new', 'processing', 'paid', 'shipped', 'completed', 'on_hold', 'returned']) {
      expect(effectsOwedByStatusTransition(onCredit, to)).toEqual([]);
      expect(effectsOwedByStatusTransition(onTransfer, to)).toEqual([]);
    }
  });
});

describe('effectsOwedByPaymentStatusChange', () => {
  it('a credit order marked paid owes the credit release', () => {
    expect(effectsOwedByPaymentStatusChange(onCredit, 'paid')).toEqual([
      { effect: 'credit.release', reason: 'invoice_paid' },
    ]);
  });

  it('an order that drew no credit owes nothing when marked paid', () => {
    expect(effectsOwedByPaymentStatusChange(onTransfer, 'paid')).toEqual([]);
  });

  it('no other payment status owes anything', () => {
    for (const to of ['refunded', 'awaiting_payment', 'deferred', 'failed']) {
      expect(effectsOwedByPaymentStatusChange(onCredit, to)).toEqual([]);
    }
  });
});

describe('ownerOfEffect', () => {
  it('names the module each release belongs to', () => {
    expect(ownerOfEffect('stock.release')).toBe('inventory');
    expect(ownerOfEffect('credit.release')).toBe('credit_limits');
  });
});
