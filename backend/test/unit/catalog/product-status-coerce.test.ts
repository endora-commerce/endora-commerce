import { describe, expect, it } from 'vitest';
import {
  coerceProductStatusWrite,
  productStatusWriteSchema,
} from '@b2b/contracts';

describe('product status write coercion (feature 032)', () => {
  it('maps archived → inactive in coerceProductStatusWrite', () => {
    expect(coerceProductStatusWrite('archived')).toBe('inactive');
    expect(coerceProductStatusWrite('active')).toBe('active');
  });

  it('productStatusWriteSchema accepts archived alias and outputs inactive', () => {
    expect(productStatusWriteSchema.parse('archived')).toBe('inactive');
    expect(productStatusWriteSchema.parse('inactive')).toBe('inactive');
  });
});
