import { describe, expect, it } from 'vitest';
import { settledReturnLine } from './refund-math.js';

/**
 * Issue #854, owner ruling of 2026-11-07: the amount withheld on a return is
 * part of the goods' price, at the goods' VAT rate — per line, the default
 * less what was approved.
 */
describe('settledReturnLine', () => {
  const row = (over: Partial<Parameters<typeof settledReturnLine>[0]> = {}) => ({
    defaultRefundAmount: '12.30',
    defaultDiscountAmount: '0.00',
    approvedRefundAmount: '12.30',
    ...over,
  });

  it('withholds nothing when the default was approved', () => {
    expect(settledReturnLine(row())).toEqual({ discount: '0.00', retained: '0.00' });
  });

  it('withholds what the operator took off the default', () => {
    expect(settledReturnLine(row({ approvedRefundAmount: '10.00' }))).toEqual({ discount: '0.00', retained: '2.30' });
  });

  it('withholds everything when nothing was approved', () => {
    expect(settledReturnLine(row({ approvedRefundAmount: '0.00' }))).toEqual({ discount: '0.00', retained: '12.30' });
  });

  it('carries the whole default discount back, and withholds no discount of its own', () => {
    expect(
      settledReturnLine(row({ defaultRefundAmount: '10.01', defaultDiscountAmount: '2.31', approvedRefundAmount: '5.00' })),
    ).toEqual({ discount: '2.31', retained: '5.01' });
    expect(
      settledReturnLine(row({ defaultRefundAmount: '20.00', defaultDiscountAmount: '4.00', approvedRefundAmount: '20.00' })),
    ).toEqual({ discount: '4.00', retained: '0.00' });
  });
});
