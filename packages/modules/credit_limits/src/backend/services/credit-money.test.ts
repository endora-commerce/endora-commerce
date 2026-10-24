import { describe, expect, it } from 'vitest';
import { availableCredit, coversAmount, creditAmount } from './credit-money.js';

/**
 * Issue #417 — the credit arithmetic a reservation decides on, exact. On
 * doubles, a 0.30 limit with 0.10 reserved had 0.19999999999999998 available
 * and refused a 0.20 order as `LIMIT_INSUFFICIENT`.
 */
describe('credit money', () => {
  it('answers the available credit exactly, not the binary 0.19999999999999998', () => {
    expect(0.3 - 0.1).toBe(0.19999999999999998);
    expect(availableCredit('0.30', '0.10')).toBe('0.20');
  });

  it('lets an order equal to the available credit through', () => {
    expect(coversAmount(availableCredit('0.30', '0.10'), 0.2)).toBe(true);
    expect(coversAmount('0.20', 0.21)).toBe(false);
  });

  it('stores an amount half-up on its decimal digits, not the binary 1.00', () => {
    expect((1.005).toFixed(2)).toBe('1.00');
    expect(creditAmount(1.005)).toBe('1.01');
    expect(creditAmount('250')).toBe('250.00');
  });
});
