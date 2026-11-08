import { describe, expect, it } from 'vitest';
import { entersKeptState, entersKeptStateProvisionally, refundsOutsideKeptState } from './kept-state.js';

/**
 * Issues #874 and #875 — which cases decide what the buyer keeps. Only goods
 * given back for money leave the kept state: a `return` case settled with a
 * refund or a credit, the predicate `listReturnedQuantities` reads. A
 * replacement or a repair sends goods back to the buyer, and a complaint is a
 * price reduction of goods the buyer keeps (issue #885), so neither counts. A
 * complaint that moved money is counted apart, against what is left paid.
 */
const settled = (kind: 'return' | 'complaint', resolutionType: string | null, statusCode = 'resolved') => ({
  kind,
  resolutionType: resolutionType as 'refund' | 'credit' | 'replacement' | 'repair' | null,
  statusCode,
});

describe('kept state — settled basis (#874, #875)', () => {
  it('a return settled with a refund or a credit leaves the kept state', () => {
    expect(entersKeptState(settled('return', 'refund'))).toBe(true);
    expect(entersKeptState(settled('return', 'credit'))).toBe(true);
  });

  it('a return replaced or repaired, an unsettled return and every complaint do not', () => {
    expect(entersKeptState(settled('return', 'replacement'))).toBe(false);
    expect(entersKeptState(settled('return', 'repair'))).toBe(false);
    expect(entersKeptState(settled('return', null, 'received'))).toBe(false);
    expect(entersKeptState(settled('complaint', 'refund'))).toBe(false);
    expect(entersKeptState(settled('complaint', 'credit'))).toBe(false);
  });
});

describe('kept state — provisional basis, at case creation (#875)', () => {
  it('counts a live return not yet settled, and a return settled for money', () => {
    expect(entersKeptStateProvisionally(settled('return', null, 'submitted'))).toBe(true);
    expect(entersKeptStateProvisionally(settled('return', null, 'received'))).toBe(true);
    expect(entersKeptStateProvisionally(settled('return', 'refund'))).toBe(true);
    expect(entersKeptStateProvisionally(settled('return', 'credit'))).toBe(true);
  });

  it('leaves out a rejected or cancelled return, a replaced or repaired one, and every complaint', () => {
    expect(entersKeptStateProvisionally(settled('return', null, 'rejected'))).toBe(false);
    expect(entersKeptStateProvisionally(settled('return', null, 'cancelled'))).toBe(false);
    expect(entersKeptStateProvisionally(settled('return', 'replacement'))).toBe(false);
    expect(entersKeptStateProvisionally(settled('return', 'repair'))).toBe(false);
    expect(entersKeptStateProvisionally(settled('complaint', null, 'submitted'))).toBe(false);
    expect(entersKeptStateProvisionally(settled('complaint', 'refund'))).toBe(false);
  });
});

describe('money outside the kept state (#874)', () => {
  it('is a complaint settled with a refund or a credit', () => {
    expect(refundsOutsideKeptState(settled('complaint', 'refund'))).toBe(true);
    expect(refundsOutsideKeptState(settled('complaint', 'credit'))).toBe(true);
  });

  it('is never a complaint replaced, repaired or unsettled, nor a return', () => {
    expect(refundsOutsideKeptState(settled('complaint', 'replacement'))).toBe(false);
    expect(refundsOutsideKeptState(settled('complaint', 'repair'))).toBe(false);
    expect(refundsOutsideKeptState(settled('complaint', null, 'received'))).toBe(false);
    expect(refundsOutsideKeptState(settled('return', 'refund'))).toBe(false);
  });
});
