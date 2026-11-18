import { describe, expect, it } from 'vitest';
import { paymentStatusSchema, type PaymentStatus } from '@endora-commerce/contracts';
import { decidePaymentStatusChange, type PaymentStatusDecision } from './payment-status-transition.js';

/**
 * Issue #1574 — the full from × to × actor matrix of the money axis. The table
 * reads one row per `from`, one column per `to`; `apply` is an edge, `same` the
 * no-op, and a refusal names its token (`null` where no sentence is more
 * specific than the code's own).
 */
type Cell = 'apply' | 'same' | 'refunded' | 'not_paid' | 'refused';

const OPERATOR: Record<PaymentStatus, Record<PaymentStatus, Cell>> = {
  awaiting_payment: { awaiting_payment: 'same', paid: 'apply', failed: 'refused', deferred: 'refused', refunded: 'not_paid' },
  failed: { awaiting_payment: 'refused', paid: 'apply', failed: 'same', deferred: 'refused', refunded: 'not_paid' },
  deferred: { awaiting_payment: 'refused', paid: 'apply', failed: 'refused', deferred: 'same', refunded: 'not_paid' },
  paid: { awaiting_payment: 'refused', paid: 'same', failed: 'refused', deferred: 'refused', refunded: 'apply' },
  refunded: { awaiting_payment: 'refunded', paid: 'refunded', failed: 'refunded', deferred: 'refunded', refunded: 'same' },
};

const SETTLEMENT: Record<PaymentStatus, Record<PaymentStatus, Cell>> = {
  ...OPERATOR,
  awaiting_payment: { ...OPERATOR.awaiting_payment, failed: 'apply' },
};

function expected(cell: Cell): PaymentStatusDecision {
  switch (cell) {
    case 'apply':
      return { kind: 'apply' };
    case 'same':
      return { kind: 'unchanged' };
    case 'refunded':
      return { kind: 'refused', token: 'payment_refunded' };
    case 'not_paid':
      return { kind: 'refused', token: 'payment_not_paid' };
    case 'refused':
      return { kind: 'refused', token: null };
  }
}

describe('decidePaymentStatusChange (issue #1574, U1)', () => {
  for (const [actor, table] of [
    ['operator', OPERATOR],
    ['settlement', SETTLEMENT],
  ] as const) {
    for (const from of paymentStatusSchema.options) {
      for (const to of paymentStatusSchema.options) {
        it(`${actor}: ${from} -> ${to} is ${table[from][to]}`, () => {
          expect(decidePaymentStatusChange(from, to, actor)).toEqual(expected(table[from][to]));
        });
      }
    }
  }

  it('refuses the reported bug: a refunded order is never marked paid again, by either actor', () => {
    expect(decidePaymentStatusChange('refunded', 'paid', 'operator')).toEqual({
      kind: 'refused',
      token: 'payment_refunded',
    });
    expect(decidePaymentStatusChange('refunded', 'paid', 'settlement').kind).toBe('refused');
  });
});
