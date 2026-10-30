import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord } from '@endora-commerce/contracts';
import { createNamedListPriceResolver } from './named-list-price-resolver.js';
import { FeedGenerationService, type FeedItemHydrationScope } from './feed-generation.service.js';

/**
 * Review 2, finding 1 (release 0.108.0) — a resolver amount crosses this
 * module's price ports as the decimal string `price_lists` answers with, and
 * is rounded only by the decimal helpers. It was turned into a JS number at
 * the boundary (`Map<string, number>`), which is what let binary arithmetic in
 * (the gross feed's 36.28, finding 2).
 */
describe('product feed price ports carry decimal strings', () => {
  const port = { namedListPrices: async () => new Map([['p1', '9.0450'], ['p0', '0.0000']]) };

  it('the named-book read answers the decimal strings verbatim, zero included', async () => {
    const resolver = createNamedListPriceResolver(port);
    const many = await resolver.many({ priceListId: 'book', productIds: ['p1', 'p0'], currencyCode: 'PLN' });
    expect(many).toEqual(new Map([['p1', '9.0450'], ['p0', '0.0000']]));
    expect(await resolver.one({ priceListId: 'book', productId: 'p1', currencyCode: 'PLN' })).toBe('9.0450');
  });

  it('a hydrated item carries the net and gross prices as decimal strings', async () => {
    const product = { id: 'p1', slug: 'p1', type: 'simple', name: { 'pl-PL': 'p1' }, description: {}, attributeValues: {} };
    const generation = new FeedGenerationService({
      catalogProducts: { findByIds: async () => [product as unknown as CatalogProductRecord], listVariantsByProductIds: async () => [] },
      catalogCategories: { listAssignmentsForProducts: async () => [], findByIds: async () => [] },
      catalogGallery: { listForProducts: async () => [] },
      catalogUrlKeys: { effectiveKeys: async () => new Map() },
      resolvePublicImageUrls: async () => new Map(),
      resolveAvailability: async () => new Map(),
      resolveNamedListPrice: createNamedListPriceResolver(port).many,
      resolveTaxRate: async () => 23,
    } as never);
    const scope = (pricePresentation: 'gross' | 'net'): FeedItemHydrationScope => ({
      salesChannelId: 'channel-1',
      channelDefaultCurrency: 'PLN',
      taxonomy: null,
      itemGranularity: 'product',
      context: {
        languageCode: 'pl-PL',
        languageFallbacks: [],
        currencyCode: 'PLN',
        pricePresentation,
        taxCountry: 'PL',
        storefrontOrigin: 'https://shop.example.com',
        channelUrl: { languages: ['pl-PL'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: false },
        salesChannelId: 'channel-1',
        priceListId: 'book',
      },
    });
    const [net] = await generation.hydrateItems(['p1'], scope('net'));
    expect(net!.price).toEqual({ net: '9.0450', gross: '9.0450', taxResolved: true, taxRatePercent: null });
    const [gross] = await generation.hydrateItems(['p1'], scope('gross'));
    expect(gross!.price).toEqual({ net: '9.0450', gross: '11.13', taxResolved: true, taxRatePercent: 23 });
  });
});
