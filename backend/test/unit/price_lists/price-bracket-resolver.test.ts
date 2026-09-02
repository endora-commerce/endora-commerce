import { describe, expect, it } from 'vitest';
import {
  resolvePriceBracket,
  type PriceBracketRow,
} from '../../../../packages/modules/price_lists/src/backend/services/price-bracket-resolver.js';

function row(over: Partial<PriceBracketRow>): PriceBracketRow {
  return {
    priceListId: 'pl-1',
    productId: 'p-1',
    currencyCode: 'PLN',
    minQuantity: 1,
    maxQuantity: null,
    amount: '100.00',
    ...over,
  };
}

describe('resolvePriceBracket (T019)', () => {
  it('returns the open-ended single bracket for any qty >= 1', () => {
    const brackets = [row({ minQuantity: 1, maxQuantity: null, amount: '100.00' })];
    expect(resolvePriceBracket(brackets, 'PLN', 1)?.amount).toBe('100.00');
    expect(resolvePriceBracket(brackets, 'PLN', 50)?.amount).toBe('100.00');
    expect(resolvePriceBracket(brackets, 'PLN', 10000)?.amount).toBe('100.00');
  });

  it('picks the matching bracket from multiple non-overlapping closed brackets', () => {
    const brackets = [
      row({ minQuantity: 1, maxQuantity: 9, amount: '100.00' }),
      row({ minQuantity: 10, maxQuantity: 99, amount: '90.00' }),
      row({ minQuantity: 100, maxQuantity: null, amount: '80.00' }),
    ];
    expect(resolvePriceBracket(brackets, 'PLN', 1)?.amount).toBe('100.00');
    expect(resolvePriceBracket(brackets, 'PLN', 9)?.amount).toBe('100.00');
    expect(resolvePriceBracket(brackets, 'PLN', 10)?.amount).toBe('90.00');
    expect(resolvePriceBracket(brackets, 'PLN', 99)?.amount).toBe('90.00');
    expect(resolvePriceBracket(brackets, 'PLN', 100)?.amount).toBe('80.00');
    expect(resolvePriceBracket(brackets, 'PLN', 10000)?.amount).toBe('80.00');
  });

  it('returns null on the bracket-gap fall-through case (FR-031)', () => {
    const brackets = [
      row({ minQuantity: 1, maxQuantity: 9, amount: '100.00' }),
      row({ minQuantity: 100, maxQuantity: null, amount: '80.00' }),
    ];
    expect(resolvePriceBracket(brackets, 'PLN', 50)).toBeNull();
  });

  it('returns null when the requested currency has no brackets', () => {
    const brackets = [row({ currencyCode: 'PLN', minQuantity: 1, amount: '100.00' })];
    expect(resolvePriceBracket(brackets, 'EUR', 1)).toBeNull();
  });

  it('treats currencies independently (PLN brackets do not affect EUR lookups)', () => {
    const brackets = [
      row({ currencyCode: 'PLN', minQuantity: 1, maxQuantity: 9, amount: '100.00' }),
      row({ currencyCode: 'PLN', minQuantity: 10, maxQuantity: null, amount: '90.00' }),
      row({ currencyCode: 'EUR', minQuantity: 1, maxQuantity: null, amount: '24.00' }),
    ];
    expect(resolvePriceBracket(brackets, 'PLN', 10)?.amount).toBe('90.00');
    expect(resolvePriceBracket(brackets, 'EUR', 10)?.amount).toBe('24.00');
    expect(resolvePriceBracket(brackets, 'EUR', 1)?.amount).toBe('24.00');
  });

  it('returns null for qty < 1', () => {
    const brackets = [row({ minQuantity: 1, maxQuantity: null, amount: '100.00' })];
    expect(resolvePriceBracket(brackets, 'PLN', 0)).toBeNull();
  });
});
