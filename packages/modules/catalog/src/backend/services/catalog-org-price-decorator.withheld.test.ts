import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode, LinePriceResult, ProductDetail, ProductSummary } from '@endora-commerce/contracts';
import { CatalogOrgPriceDecorator } from './catalog-org-price-decorator.js';

/**
 * Issue #491 — the external catalogue API publishes **line** answers to a bound
 * API key, and a line keeps its amount under display mode `none` (it is the
 * charging path). So the decorator withholds it: a product whose display mode
 * is `none` for the bound Organization gets no price, no tier ladder and no
 * bulk price, exactly as a product nothing prices.
 */
describe('CatalogOrgPriceDecorator — display mode `none` withholds the amount (#491)', () => {
  const CHANNEL = { id: 'ch', defaultCurrency: 'PLN' };
  const products = [
    { id: 'p-quote', sku: 'QUOTE-1' },
    { id: 'p-priced', sku: 'PRICED-1' },
  ];
  const modeOf: Record<string, DisplayMode> = { 'p-quote': 'none', 'p-priced': 'gross_only' };
  const amountOf: Record<string, string> = { 'p-quote': '70.0000', 'p-priced': '50.0000' };

  function decorator() {
    const em = {
      find: async (_entity: unknown, where: { id?: { $in: string[] }; sku?: { $in: string[] } }) =>
        products.filter((p) => where.id?.$in.includes(p.id) || where.sku?.$in.includes(p.sku)),
      findOne: async (_entity: unknown, where: { id: string }) => products.find((p) => p.id === where.id) ?? null,
    } as unknown as EntityManager;
    const line = (productId: string): LinePriceResult => ({
      amount: amountOf[productId]!,
      currency: 'PLN',
      priceListId: 'book',
      isSale: false,
      bracketStartQuantity: 1,
      displayMode: modeOf[productId]!,
    });
    return new CatalogOrgPriceDecorator({
      emFactory: () => em,
      pricingService: {
        resolveLinePrice: async () => null,
        listTierStarts: async () => [10],
        resolveLinePrices: async ({ lines }: { lines: readonly { key: string; product: { id: string } }[] }) =>
          new Map(lines.map((l) => [l.key, line(l.product.id)] as const)),
      } as never,
      organizations: { findById: async (id: string) => ({ id, customerGroupId: null }) } as never,
      // Feature 163 (W5) — every product is available here: this suite is about display modes.
      availability: { filterAvailable: async (ids: readonly string[]) => new Set(ids) } as never,
    });
  }

  const summary = (id: string): ProductSummary =>
    ({ id, sku: id, type: 'simple', name: id, slug: id, categorySlugs: [], primaryAssetUrl: null, price: null, stockIndicator: null, stockLevel: null }) as ProductSummary;

  it('a bound summary list: no price for the product whose mode is `none`, the price for the other', async () => {
    const out = await decorator().decorateSummaries([summary('p-quote'), summary('p-priced')], {
      organizationId: 'org',
      salesChannel: CHANNEL,
    });
    expect(out[0]).toMatchObject({ id: 'p-quote', price: null, priceUnavailable: true });
    expect(out[1]).toMatchObject({ id: 'p-priced', price: { amount: 50, currency: 'PLN' } });
    expect(out[1]?.priceUnavailable).toBeUndefined();
  });

  it('a bound detail: no tier ladder for the product whose mode is `none`', async () => {
    const detail = await decorator().decorateDetail(summary('p-quote') as unknown as ProductDetail, {
      organizationId: 'org',
      salesChannel: CHANNEL,
    });
    expect(detail.price).toBeNull();
    expect((detail as { priceTiers?: unknown[] }).priceTiers).toEqual([]);
  });

  it('a bulk request: `price_unavailable` for the product whose mode is `none`', async () => {
    const out = await decorator().resolveBulkPrices(
      [
        { sku: 'QUOTE-1', quantity: 5 },
        { sku: 'PRICED-1', quantity: 5 },
      ],
      { organizationId: 'org', salesChannel: CHANNEL, audience: { organizationId: 'org', authenticated: true } },
    );
    expect(out[0]).toEqual({ sku: 'QUOTE-1', quantity: 5, price: null, reason: 'price_unavailable' });
    expect(out[1]).toMatchObject({ sku: 'PRICED-1', price: { amount: '50.0000', currency: 'PLN' } });
  });
});
