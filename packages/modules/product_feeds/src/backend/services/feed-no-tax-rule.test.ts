import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord } from '@endora-commerce/contracts';
import { PREDEFINED_TEMPLATES } from '../seeds/predefined-templates.js';
import { FeedGenerationService, type FeedItemHydrationScope } from './feed-generation.service.js';
import { resolveFeedItem } from './item-field-resolver.js';
import type { ResolvableTemplateField } from './item-field-resolver.interface.js';

/**
 * Issue #974 — "no tax rule" (`TaxService` answers `source: 'none'`) means no
 * VAT is charged, and every surface publishes the same amount
 * (`specs/conventions/pricing.md`). Order, quote, cart and catalogue carry it
 * as rate `0`; a feed carries it as `taxRatePercent: null`, which never reaches
 * the file. So a gross feed with no rule publishes exactly what a configured
 * 0 % rule publishes, and differs only by the `zero_tax_rate_on_gross_feed`
 * warning — never a net price presented as gross without a word.
 *
 * This pins existing behaviour; it does not change it.
 */
const PRODUCTS: Record<string, string> = {
  unit: '29.5000',
  // Sub-cent: published as a pack of 100 (issue #430), whose gross is
  // computed at `taxRatePercent` — the path where `null` and `0` could part.
  pack: '0.0125',
};

function generation(rate: number | null): FeedGenerationService {
  const products = Object.keys(PRODUCTS).map(
    (id) =>
      ({ id, slug: id, type: 'simple', name: { 'pl-PL': id }, description: { 'pl-PL': id }, attributeValues: {} }) as unknown as CatalogProductRecord,
  );
  return new FeedGenerationService({
    catalogProducts: { findByIds: async () => products, listVariantsByProductIds: async () => [] },
    catalogCategories: { listAssignmentsForProducts: async () => [], findByIds: async () => [] },
    catalogGallery: { listForProducts: async () => [] },
    catalogUrlKeys: { effectiveKeys: async () => new Map() },
    resolvePublicImageUrls: async () => new Map(),
    resolveAvailability: async () => new Map(),
    resolveAnonymousPrice: async () =>
      new Map(Object.entries(PRODUCTS).map(([id, net]) => [id, { amount: net, isSale: false }])),
    // `null` is what the plugin's resolver answers for `source: 'none'`.
    resolveTaxRate: async () => rate,
  } as never);
}

const SCOPE: FeedItemHydrationScope = {
  salesChannelId: 'channel-1',
  channelDefaultCurrency: 'PLN',
  taxonomy: null,
  itemGranularity: 'product',
  context: {
    languageCode: 'pl-PL',
    languageFallbacks: [],
    currencyCode: 'PLN',
    pricePresentation: 'gross',
    taxCountry: 'PL',
    storefrontOrigin: 'https://shop.example.com',
    channelUrl: { languages: ['pl-PL'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: false },
    salesChannelId: 'channel-1',
    priceListId: null,
  },
};

const FIELDS: ResolvableTemplateField[] = PREDEFINED_TEMPLATES.find(
  (t) => t.systemCode === 'google_merchant_v1',
)!.fields.map((f) => ({
  outputName: f.outputName,
  sourceKind: f.sourceKind,
  sourceKey: f.sourceKey ?? null,
  constantValue: f.constantValue ?? null,
  fallbackValue: f.fallbackValue ?? null,
  providerRequired: f.providerRequired ?? false,
  transform: null,
  transformArg: null,
}));

async function published(rate: number | null, productId: string) {
  const items = await generation(rate).hydrateItems(Object.keys(PRODUCTS), SCOPE);
  const item = items.find((i) => i.productId === productId)!;
  return { item, out: resolveFeedItem({ fields: FIELDS, item, context: SCOPE.context }) };
}

describe('a gross feed with no tax rule (source: none) publishes the same amount as a 0 % rule', () => {
  it('prices a none line net: gross is the net, taxResolved false, no rate', async () => {
    const { item } = await published(null, 'unit');
    expect(item.price).toEqual({ net: '29.5000', gross: '29.5000', taxResolved: false, taxRatePercent: null });
  });

  it.each(Object.keys(PRODUCTS))('%s: every published field is identical; only the warning differs', async (id) => {
    const none = await published(null, id);
    const zero = await published(0, id);

    expect(zero.item.price?.taxResolved).toBe(true);
    expect(zero.item.price?.taxRatePercent).toBe(0);
    expect(none.out.skipped).toBe(false);
    expect(none.out.fields).toEqual(zero.out.fields);
    expect(none.out.fields.find((f) => f.name === 'g:price')?.value).toBe(id === 'unit' ? '29.50 PLN' : '1.25 PLN');

    const warning = 'zero_tax_rate_on_gross_feed';
    expect(none.out.issues).toContainEqual(expect.objectContaining({ severity: 'warning', reason: warning }));
    expect(zero.out.issues).not.toContainEqual(expect.objectContaining({ reason: warning }));
    expect(none.out.issues.filter((i) => i.reason !== warning)).toEqual(zero.out.issues);
  });
});
