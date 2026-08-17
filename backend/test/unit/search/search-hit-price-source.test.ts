import { describe, expect, it } from 'vitest';
import type { ListingPrice } from '@b2b/contracts';
import { searchHitSummary } from '../../../src/modules/search/services/search-query.service.js';

/**
 * Issue #132 — a search hit prices through `price_lists`, like every other
 * listing.
 *
 * `search` hydrates its hits from Postgres precisely so the channel rule stays
 * authoritative rather than trusting whatever the indexer snapshotted. It then
 * read `attributeValues.defaultPrice` off the hydrated row, which put the one
 * figure it was hydrating for outside the pricing engine.
 */

const CHANNEL = {
  id: '00000000-0000-4000-8000-0000000000c1',
  code: 'pl_retail',
  isPublic: true,
  defaultCurrency: 'PLN',
  defaultLanguage: 'pl-PL',
};

const PRODUCT = {
  id: 'p1',
  sku: 'SKU-1',
  type: 'simple' as const,
  slug: 'widget',
  name: { 'pl-PL': 'Widżet' },
  attributeValues: { defaultPrice: 19.99 },
};

const HIT = {
  id: 'p1',
  sku: 'SKU-1',
  type: 'simple' as const,
  slug: 'widget',
  name: 'Widget',
  categorySlugs: ['tools'],
  primaryAssetUrl: null,
};

function summaryFor(price: ListingPrice | undefined) {
  return searchHitSummary(PRODUCT as never, HIT, CHANNEL, undefined, price);
}

describe('search hit price source (#132)', () => {
  it('quotes the price list amount, not the catalogue attribute', () => {
    const summary = summaryFor({
      source: 'price_list',
      amount: '88.00',
      currency: 'PLN',
      priceListId: '11111111-1111-4111-8111-111111111111',
      isSale: false,
    });
    expect(summary.price).toEqual({ amount: 88, currency: 'PLN' });
  });

  it('renders a resolved zero as zero rather than as an absence', () => {
    const summary = summaryFor({
      source: 'price_list',
      amount: '0.00',
      currency: 'PLN',
      priceListId: '11111111-1111-4111-8111-111111111111',
      isSale: false,
    });
    expect(summary.price).toEqual({ amount: 0, currency: 'PLN' });
  });

  it("uses the Product's own price when the chain fell through to it", () => {
    const summary = summaryFor({ source: 'product', amount: '19.99', currency: 'PLN' });
    expect(summary.price).toEqual({ amount: 19.99, currency: 'PLN' });
  });

  it('renders no price for the `none` arm, even though the row carries a legacy attribute', () => {
    expect(summaryFor({ source: 'none' }).price).toBeNull();
  });

  it('renders no price when the channel withheld the resolution entirely', () => {
    expect(summaryFor(undefined).price).toBeNull();
  });
});
