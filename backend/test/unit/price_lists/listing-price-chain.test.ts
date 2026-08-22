import { describe, expect, it } from 'vitest';
import { listingPriceMoney } from '@endora-commerce/contracts';
import { listingPriceFrom } from '../../../src/modules/price_lists/services/listing-price-chain.js';
import type { PricingLineResult } from '../../../src/modules/price_lists/services/pricing-service.interface.js';

/**
 * The product ruling for issue #132, as a pure function:
 * applicable price list → the product's own price → nothing.
 *
 * The third step is a margin, not a common path — there is always one default
 * price list, guarded three ways by `PriceListService` — but "nothing" is a
 * state a listing has to render honestly, so it is an arm of the union rather
 * than a zero or a throw.
 */

function line(over: Partial<PricingLineResult> = {}): PricingLineResult {
  return {
    amount: '199.00',
    currency: 'PLN',
    priceListId: '11111111-1111-4111-8111-111111111111',
    isSale: false,
    bracketStartQuantity: 1,
    displayMode: 'net_only',
    ...over,
  };
}

function product(attributeValues: Record<string, unknown>): { attributeValues: Record<string, unknown> } {
  return { attributeValues };
}

describe('listingPriceFrom — the price-list → product → nothing chain (#132)', () => {
  it('takes the price list when one applied, and says so', () => {
    const resolved = listingPriceFrom(line(), product({ defaultPrice: 49.99 }), 'PLN');
    expect(resolved).toEqual({
      source: 'price_list',
      amount: '199.00',
      currency: 'PLN',
      priceListId: '11111111-1111-4111-8111-111111111111',
      isSale: false,
    });
    // The list wins over the product's own figure — that is the whole defect
    // this issue is about: a listing showing a price no price list supports.
    expect(listingPriceMoney(resolved)).toEqual({ amount: 199, currency: 'PLN' });
  });

  it('renders a price list amount of zero as zero, not as an absence', () => {
    const resolved = listingPriceFrom(line({ amount: '0.00' }), product({}), 'PLN');
    expect(resolved.source).toBe('price_list');
    expect(listingPriceMoney(resolved)).toEqual({ amount: 0, currency: 'PLN' });
  });

  it('falls back to the price assigned directly to the Product when no list applied', () => {
    const resolved = listingPriceFrom(null, product({ defaultPrice: 49.99 }), 'PLN');
    expect(resolved).toEqual({ source: 'product', amount: '49.99', currency: 'PLN' });
    expect(listingPriceMoney(resolved)).toEqual({ amount: 49.99, currency: 'PLN' });
  });

  it('reads the older `price` key when `defaultPrice` is absent', () => {
    const resolved = listingPriceFrom(null, product({ price: '12.5' }), 'EUR');
    expect(resolved).toEqual({ source: 'product', amount: '12.50', currency: 'EUR' });
  });

  it('renders a product price of zero as zero, not as an absence', () => {
    const resolved = listingPriceFrom(null, product({ defaultPrice: 0 }), 'PLN');
    expect(resolved).toEqual({ source: 'product', amount: '0.00', currency: 'PLN' });
    expect(listingPriceMoney(resolved)).toEqual({ amount: 0, currency: 'PLN' });
  });

  it('answers `none` — with no amount to spend — when neither step produced a price', () => {
    const resolved = listingPriceFrom(null, product({}), 'PLN');
    expect(resolved).toEqual({ source: 'none' });
    expect(listingPriceMoney(resolved)).toBeNull();
    // The absent arm carries no `amount` at all, so `.amount` does not compile
    // until the caller narrows (the `ResolvedTax` precedent, issue #124).
    expect(Object.keys(resolved)).toEqual(['source']);
  });

  it('answers `none` for a product attribute that is not a finite number', () => {
    expect(listingPriceFrom(null, product({ defaultPrice: 'on request' }), 'PLN')).toEqual({
      source: 'none',
    });
    expect(listingPriceFrom(null, product({ defaultPrice: null }), 'PLN')).toEqual({
      source: 'none',
    });
    expect(listingPriceFrom(null, product({ defaultPrice: -1 }), 'PLN')).toEqual({
      source: 'none',
    });
  });

  it('normalises the currency the listing quotes to upper case', () => {
    expect(listingPriceFrom(null, product({ defaultPrice: 5 }), 'pln')).toEqual({
      source: 'product',
      amount: '5.00',
      currency: 'PLN',
    });
  });
});
