import { describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  type CatalogProductReadPort,
  type CatalogProductValueOverrideRecord,
  type ListingPriceDetailPort,
} from '@endora-commerce/contracts';
import { SearchQueryService, type ResolvedSearchChannel } from './search-query.service.js';

/**
 * Issue #384 — a search result card shows the same effective name as the
 * catalogue's listing card for the request's (sales channel, language).
 *
 * The hydration used to pick the name off the baseline JSONB alone, so after
 * the catalogue's storefront reads started honouring `product_value_overrides`
 * a product showed its override on the product page and the catalogue listing
 * and its baseline in the search results. The indexed `hit.name` is no answer
 * either: the indexer resolves it in the channel's default language only, so
 * it is wrong for a request in any other language.
 *
 * `hydrateHits` is the post-Meilisearch step of `listProducts`, so these cases
 * need no search engine.
 */

const CHANNEL: ResolvedSearchChannel = {
  id: '00000000-0000-4000-8000-0000000000c1',
  code: 'pl_retail',
  defaultCurrency: 'PLN',
  defaultLanguage: 'pl-PL',
  languages: ['pl-PL', 'en-US'],
};
const OTHER_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c2';

function product(id: string, name: string) {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple' as const,
    status: 'active' as const,
    name,
    description: null,
    visibility: 'public' as const,
    allowedOrganizationIds: [],
    attributeValues: {},
    minOrderQuantity: null,
  };
}

function hit(id: string, name = 'Indexed name') {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple' as const,
    name,
    categorySlugs: [],
    primaryAssetUrl: null,
  };
}

function override(
  productId: string,
  channelId: string,
  languageCode: string | null,
  v: unknown,
  attributeKey = 'name',
): CatalogProductValueOverrideRecord {
  return {
    id: `${productId}-${channelId}-${languageCode ?? 'any'}-${attributeKey}`,
    productId,
    attributeKey,
    channelId,
    languageCode,
    value: { v },
  };
}

function serviceWith(
  products: ReturnType<typeof product>[],
  overrides: CatalogProductValueOverrideRecord[],
) {
  const listValueOverridesByProductIds = vi.fn(
    async (ids: readonly string[], options?: { channelId?: string }) =>
      overrides.filter(
        (o) =>
          ids.includes(o.productId) &&
          (options?.channelId === undefined || o.channelId === options.channelId),
      ),
  );
  const port = {
    findByIds: async (ids: readonly string[]) => products.filter((p) => ids.includes(p.id)),
    listValueOverridesByProductIds,
  } as unknown as CatalogProductReadPort;
  // Names are this file's subject, not prices: the pricing port resolves nothing.
  const prices = { resolveListingPriceDetails: async () => new Map() } as unknown as ListingPriceDetailPort;
  // Feature 163 — every hit is available here; this file is about names.
  const availableEverywhere = {
    filterAvailable: async (ids: readonly string[]) => new Set(ids),
    // No channel order rule in this file: the record's minimum stands.
    effectiveOrderRules: async () => new Map<string, { minOrderQuantity: number | null; returnable: boolean }>(),
  };
  return {
    service: new SearchQueryService(port, undefined, {}, prices, undefined, availableEverywhere),
    listValueOverridesByProductIds,
  };
}

const ctx = (preferredLanguage?: string) => ({
  resolvedChannel: CHANNEL,
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
  preferredLanguage,
});

// Feature 170 (R1): the name at the request's (C, L) — C×L row → C row → the Global name.
describe('search hit names honour channel value overrides (#384, 170 chain)', () => {
  it('takes the (channel, request language) row', async () => {
    const { service } = serviceWith(
      [product('p1', 'Baseline kit')],
      [override('p1', CHANNEL.id, 'en-US', 'Retail kit'), override('p1', CHANNEL.id, 'pl-PL', 'Zestaw detaliczny')],
    );
    const [card] = await service.hydrateHits([hit('p1')], ctx('en-US'));
    expect(card?.name).toBe('Retail kit');
  });

  it("an unoffered request language is answered at the channel's default language", async () => {
    const { service } = serviceWith(
      [product('p1', 'Baseline kit')],
      [override('p1', CHANNEL.id, 'pl-PL', 'Zestaw detaliczny'), override('p1', CHANNEL.id, null, 'Channel name')],
    );
    const [card] = await service.hydrateHits([hit('p1')], ctx('de-DE'));
    expect(card?.name).toBe('Zestaw detaliczny');
  });

  it('takes the channel row when the language has none, never another language', async () => {
    const { service } = serviceWith(
      [product('p1', 'Baseline kit')],
      [override('p1', CHANNEL.id, 'pl-PL', 'Zestaw detaliczny'), override('p1', CHANNEL.id, null, 'Channel name')],
    );
    const [card] = await service.hydrateHits([hit('p1')], ctx('en-US'));
    expect(card?.name).toBe('Channel name');
  });

  it("ignores another channel's row and keeps the Global name", async () => {
    const { service } = serviceWith(
      [product('p1', 'Baseline kit')],
      [override('p1', OTHER_CHANNEL_ID, 'en-US', 'Other channel kit')],
    );
    const [card] = await service.hydrateHits([hit('p1')], ctx('en-US'));
    expect(card?.name).toBe('Baseline kit');
  });

  it('answers the Global name for a product without rows, and the indexed name for one with none', async () => {
    const { service } = serviceWith(
      [product('p1', 'Zestaw bazowy'), product('p2', '')],
      [override('p1', CHANNEL.id, 'pl-PL', 'Opis', 'description')],
    );
    const cards = await service.hydrateHits([hit('p1'), hit('p2', 'Indexed only')], ctx('en-US'));
    expect(cards.map((c) => c.name)).toEqual(['Zestaw bazowy', 'Indexed only']);
  });

  it("reads the page's override rows once, for the request's channel only", async () => {
    const { service, listValueOverridesByProductIds } = serviceWith(
      [product('p1', 'A'), product('p2', 'B')],
      [],
    );
    await service.hydrateHits([hit('p1'), hit('p2')], ctx('pl-PL'));
    expect(listValueOverridesByProductIds).toHaveBeenCalledTimes(1);
    expect(listValueOverridesByProductIds).toHaveBeenCalledWith(['p1', 'p2'], {
      channelId: CHANNEL.id,
    });
  });
});
