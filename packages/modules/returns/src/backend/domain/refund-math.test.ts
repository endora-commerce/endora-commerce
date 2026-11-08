import { describe, expect, it } from 'vitest';
import {
  approvedAmount,
  carriedDiscount,
  exceedsCap,
  settlementApproved,
  sumApproved,
} from './refund-math.js';

describe('refund math (US5 / FR-031/032)', () => {

  it('rejects an approved amount above the paid cap', () => {
    expect(exceedsCap(100.01, 100)).toBe(true);
    expect(exceedsCap(999, 100)).toBe(true);
  });

  it('accepts an approved amount at or below the cap (within tolerance)', () => {
    expect(exceedsCap(100, 100)).toBe(false);
    expect(exceedsCap(99.99, 100)).toBe(false);
    expect(exceedsCap(100.004, 100)).toBe(false); // half-cent tolerance
  });

  it('totals the approved per-line amounts to cents', () => {
    expect(sumApproved([10.1, 20.2, 30.3])).toBe(60.6);
    expect(sumApproved([])).toBe(0);
    expect(sumApproved([0.1, 0.2])).toBe(0.3); // no float drift
  });
});

/**
 * Issue #417 — the refund amounts in exact decimal arithmetic. An approved
 * amount an operator types is rounded half-up on its decimal digits before it
 * is capped, summed and stored; `Math.round((x + EPSILON) * 100) / 100` and
 * `toFixed(2)` rounded the binary double, so 1.005 became 1.00.
 */
describe('refund math — exact decimal amounts (#417)', () => {
  it('rounds an approved amount half-up, not the binary 1.00', () => {
    expect(approvedAmount(1.005)).toBe('1.01');
    expect(sumApproved([1.005])).toBe(1.01);
    expect(sumApproved([1.005, 2.675])).toBe(3.69);
  });

  it('caps the amount it will store: 100.005 rounds to 100.01, above a 100.00 cap', () => {
    expect(exceedsCap(100.005, 100)).toBe(true);
    expect(exceedsCap('100.00', '100.00')).toBe(false);
  });

});

describe('carriedDiscount (#417)', () => {
  it('scales the discount a default refund carries to the amount approved', () => {
    expect(carriedDiscount('25.00', '36.50', 36.5)).toBe('25.00');
    expect(carriedDiscount('25.00', '36.50', 18.25)).toBe('12.50');
    expect(carriedDiscount('25.00', '36.50', 0)).toBe('0.00');
    expect(carriedDiscount('0', '36.50', 36.5)).toBe('0.00');
  });

  // Review of PR #865 (F2) — a line whose discount share takes its whole value
  // refunds 0.00 by default and still carries its discount back: an invoice
  // issued after the return takes it off the discount line.
  it('carries the whole default discount of a 0.00 default refund approved as it is', () => {
    expect(carriedDiscount('25.00', '0.00', 0)).toBe('25.00');
    expect(carriedDiscount('0.01', '0.00', '0.00')).toBe('0.01');
    expect(carriedDiscount('0.00', '0.00', 0)).toBe('0.00');
  });
});

/**
 * Issue #875 (and the per-line ceiling of issue #874) — the settlement
 * recomputes the default under the order's lock, so what the operator approved
 * is mapped onto the default as it now stands. An amount equal to a default —
 * the one stored at creation, the one recomputed, or the effective default the
 * ceiling leaves — is the default approved, and settles at the effective one.
 * A lower amount is the operator's and is kept as typed. Anything else is above
 * what may be refunded and is refused, with nothing written.
 */
describe('settlementApproved (#875)', () => {
  const at = (requested: string | number, previous: string, recomputed: string, effective = recomputed, zeroIsAmount = false) =>
    settlementApproved({ requested, previousDefault: previous, recomputedDefault: recomputed, effectiveDefault: effective, zeroIsAmount });

  it('maps the default stored at creation onto the recomputed one, either way it moved', () => {
    expect(at(12.31, '12.31', '12.32')).toEqual({ approved: '12.32' });
    expect(at('12.32', '12.32', '12.31')).toEqual({ approved: '12.31' });
  });

  it('settles the recomputed default as it is', () => {
    expect(at(12.32, '12.31', '12.32')).toEqual({ approved: '12.32' });
  });

  it('keeps an amount below the default as typed', () => {
    expect(at(10, '12.31', '12.32')).toEqual({ approved: '10.00' });
    expect(at(0, '12.31', '12.32')).toEqual({ approved: '0.00' });
  });

  it('refuses an amount between the recomputed default and the stale one', () => {
    expect(at(12.33, '12.34', '12.32')).toEqual({ refused: 'refund_exceeds_paid' });
  });

  it('refuses an amount above every default', () => {
    expect(at(12.33, '12.31', '12.32')).toEqual({ refused: 'refund_exceeds_paid' });
  });

  it('maps every default onto the effective one when the line ceiling binds (AC-885-7)', () => {
    expect(at(33.07, '33.07', '33.07', '26.92')).toEqual({ approved: '26.92' });
    expect(at(26.92, '33.07', '33.07', '26.92')).toEqual({ approved: '26.92' });
    expect(at(20, '33.07', '33.07', '26.92')).toEqual({ approved: '20.00' });
    expect(at(30, '33.07', '33.07', '26.92')).toEqual({ refused: 'refund_exceeds_paid' });
  });

  it('keeps 0 for a non-returnable complaint line, whose 0 is an amount and not a default', () => {
    expect(at(0, '0.00', '4.28', '4.28', true)).toEqual({ approved: '0.00' });
    expect(at(0, '0.00', '4.28', '4.28')).toEqual({ approved: '4.28' });
  });
});
