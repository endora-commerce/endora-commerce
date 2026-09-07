import { describe, expect, it } from 'vitest';
import {
  defaultRefundForQuantity,
  exceedsCap,
  sumApproved,
} from './refund-math.js';

describe('refund math (US5 / FR-031/032)', () => {
  it('defaults the refund to paid-per-unit (incl. tax) × quantity', () => {
    // 100.00 net @ 23% tax = 123.00 gross per unit (resolved upstream) × 2 = 246.00
    expect(defaultRefundForQuantity(123, 2)).toBe(246);
    expect(defaultRefundForQuantity(49.99, 3)).toBe(149.97);
  });

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
