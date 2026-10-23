import { describe, expect, it } from 'vitest';
import { resolvedPriceEngineSchema } from '../src/price-lists.js';

/**
 * Feature 160 (FR-018) — `GET /api/v1/storefront/products/:id/resolved-price`
 * answers a product no price book prices as **unpriced**, and the schema says
 * so honestly: no book id (never an empty string), no base price, no quantity
 * bracket, no source.
 */
describe('resolvedPriceEngineSchema', () => {
  const priced = {
    baseListId: '00000000-0000-4000-8000-00000000d51b',
    basePrice: { amount: '199.0000', currency: 'PLN' },
    saleListId: null,
    salePrice: null,
    displayMode: 'gross_only',
    currencyCode: 'PLN',
    quantityBracket: { minQuantity: 1, maxQuantity: null },
    source: 'base',
  };
  const unpriced = {
    baseListId: null,
    basePrice: null,
    saleListId: null,
    salePrice: null,
    displayMode: 'gross_only',
    currencyCode: 'PLN',
    quantityBracket: null,
    source: null,
  };

  it('accepts a priced answer', () => {
    expect(resolvedPriceEngineSchema.safeParse(priced).success).toBe(true);
  });

  it('accepts an unpriced answer: nulls, not placeholders', () => {
    expect(resolvedPriceEngineSchema.safeParse(unpriced).success).toBe(true);
  });

  it('refuses an empty-string book id', () => {
    expect(resolvedPriceEngineSchema.safeParse({ ...unpriced, baseListId: '' }).success).toBe(false);
  });

  it('refuses a priced bracket without a book, and a book without a price', () => {
    expect(resolvedPriceEngineSchema.safeParse({ ...priced, baseListId: null }).success).toBe(false);
    expect(resolvedPriceEngineSchema.safeParse({ ...priced, basePrice: null }).success).toBe(false);
  });
});
