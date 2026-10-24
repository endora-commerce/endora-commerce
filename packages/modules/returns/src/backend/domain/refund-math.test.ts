import { describe, expect, it } from 'vitest';
import {
  approvedAmount,
  exceedsCap,
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
