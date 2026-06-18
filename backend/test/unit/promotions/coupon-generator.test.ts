import { describe, expect, it } from 'vitest';
import { buildCouponCode } from '../../../src/modules/promotions/services/coupon-service.js';

describe('buildCouponCode', () => {
  it('respects the digits format', () => {
    const code = buildCouponCode({ count: 1, length: 10, format: 'digits', limitScope: 'per_coupon' });
    expect(code).toMatch(/^[0-9]{10}$/);
  });

  it('respects the letters format', () => {
    const code = buildCouponCode({ count: 1, length: 8, format: 'letters', limitScope: 'per_coupon' });
    expect(code).toMatch(/^[A-Z]{8}$/);
  });

  it('applies prefix, suffix, and dash spacing', () => {
    const code = buildCouponCode({
      count: 1,
      length: 8,
      format: 'alnum',
      prefix: 'SUMMER',
      suffix: 'X',
      dashEvery: 4,
      limitScope: 'shared_batch',
    });
    // SUMMER + 4chars-4chars + X
    expect(code).toMatch(/^SUMMER[A-Z0-9]{4}-[A-Z0-9]{4}X$/);
  });

  it('inserts no dashes when dashEvery is 0/absent', () => {
    const code = buildCouponCode({ count: 1, length: 6, format: 'alnum', limitScope: 'per_coupon' });
    expect(code).not.toContain('-');
    expect(code).toHaveLength(6);
  });

  it('produces a low collision rate across many codes', () => {
    const set = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      set.add(buildCouponCode({ count: 1, length: 10, format: 'alnum', limitScope: 'per_coupon' }));
    }
    // 2000 codes from a 32^10 space — duplicates should be effectively impossible.
    expect(set.size).toBe(2000);
  });
});
