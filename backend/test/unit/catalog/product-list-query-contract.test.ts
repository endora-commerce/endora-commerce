import { describe, expect, it } from 'vitest';
import {
  isPriceSort,
  productListQuerySchema,
  productListSortSchema,
} from '@b2b/contracts';

/**
 * Feature 086 — the contract change, asserted where the contract is
 * (Principle II): `productListQuerySchema` gains two enum members and two
 * optional fields, and nothing that worked before changes shape.
 */
describe('productListQuerySchema (feature 086)', () => {
  it('accepts the two price orderings, ascending bare and descending prefixed', () => {
    expect(productListSortSchema.options).toEqual([
      'relevance',
      '-createdAt',
      'name',
      '-name',
      'price',
      '-price',
    ]);
    expect(productListQuerySchema.parse({ sort: 'price' }).sort).toBe('price');
    expect(productListQuerySchema.parse({ sort: '-price' }).sort).toBe('-price');
    expect(isPriceSort('price')).toBe(true);
    expect(isPriceSort('-price')).toBe(true);
    expect(isPriceSort('name')).toBe(false);
    expect(isPriceSort(undefined)).toBe(false);
  });

  it('is additive: a request that omits the new fields parses exactly as it did', () => {
    const parsed = productListQuerySchema.parse({ q: 'bolt', sort: 'name' });
    expect(parsed).toEqual({ q: 'bolt', sort: 'name', limit: 50 });
    expect(parsed.minPrice).toBeUndefined();
    expect(parsed.maxPrice).toBeUndefined();
  });

  it('coerces the two bounds from the wire and refuses a negative one', () => {
    expect(productListQuerySchema.parse({ minPrice: '10.5' }).minPrice).toBe(10.5);
    expect(productListQuerySchema.parse({ maxPrice: '0' }).maxPrice).toBe(0);
    expect(productListQuerySchema.safeParse({ minPrice: '-1' }).success).toBe(false);
  });

  it('refuses a minimum above a maximum, naming the parameter', () => {
    // FR-008 — a 400, never an empty page, because an empty page for a
    // contradictory range is indistinguishable from one for a genuine range.
    const refused = productListQuerySchema.safeParse({ minPrice: 100, maxPrice: 10 });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues[0]?.path).toEqual(['minPrice']);
      expect(refused.error.issues[0]?.message).toContain('maxPrice');
    }
    // Equal bounds are a legal, inclusive range.
    expect(productListQuerySchema.safeParse({ minPrice: 10, maxPrice: 10 }).success).toBe(true);
    // Either bound alone is legal.
    expect(productListQuerySchema.safeParse({ minPrice: 10 }).success).toBe(true);
    expect(productListQuerySchema.safeParse({ maxPrice: 10 }).success).toBe(true);
  });
});
