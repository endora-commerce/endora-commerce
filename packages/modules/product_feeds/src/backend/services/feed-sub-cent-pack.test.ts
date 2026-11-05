import { describe, expect, it } from 'vitest';
import { PREDEFINED_TEMPLATES } from '../seeds/predefined-templates.js';
import { buildFieldSourceCatalogue } from './field-source-catalogue.js';
import { feedPackQuantity, MAX_FEED_PACK_QUANTITY } from './feed-pack.js';
import { resolveFeedItem } from './item-field-resolver.js';
import type {
  FeedItemPrice,
  FeedItemSource,
  FeedResolutionContext,
  ResolvableTemplateField,
} from './item-field-resolver.interface.js';

/**
 * Issue #430 — a sub-cent unit price in a product feed.
 *
 * A unit price keeps up to four places (owner ruling of 2026-10-25), and a
 * feed's price grammar is two: Google rounds anything longer itself, so a
 * screw at 0.0125 PLN was published as 0.01 PLN against a landing page showing
 * 0,0125 PLN — a price mismatch. Nothing is rounded where it misleads, so such
 * an item is published as a **pack**: the price of N units, N the smallest
 * power of ten that makes it exact to the grosz, at most 10 000, carried by the
 * format's own multipack and unit-pricing fields. A template with no field for
 * the pack size cannot say what the price is the price of, so the item is
 * skipped with a reason the run report shows.
 */

const CONTEXT: FeedResolutionContext = {
  languageCode: 'pl-PL',
  languageFallbacks: [],
  currencyCode: 'PLN',
  pricePresentation: 'gross',
  taxCountry: 'PL',
  storefrontOrigin: 'https://shop.example.com',
  // Feature 167 — the channel's URL-language facts: links carry the language prefix.
  channelUrl: { languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true },
  salesChannelId: 'channel-1',
  priceListId: null,
};

function price(net: string, gross: string, taxRatePercent: number | null = 23): FeedItemPrice {
  return { net, gross, taxResolved: taxRatePercent !== null, taxRatePercent };
}

const ITEM: FeedItemSource = {
  productId: 'p-1',
  variantId: null,
  sku: 'SCREW-1',
  slug: 'screw',
  productType: 'simple',
  name: 'Wkręt',
  description: 'Wkręt',
  attributes: {},
  customFields: {},
  price: price('0.0125', '0.02'),
  salePrice: null,
  inStock: true,
  stockQuantity: null,
  imageUrls: [],
  privateImageCount: 0,
  categoryPath: [],
  providerCategory: null,
  providerCategoryMissReason: null,
  groupingId: null,
};

function templateFields(systemCode: string): ResolvableTemplateField[] {
  const template = PREDEFINED_TEMPLATES.find((t) => t.systemCode === systemCode)!;
  return template.fields.map((f) => ({
    outputName: f.outputName,
    sourceKind: f.sourceKind,
    sourceKey: f.sourceKey ?? null,
    constantValue: f.constantValue ?? null,
    fallbackValue: f.fallbackValue ?? null,
    providerRequired: f.providerRequired ?? false,
    transform: null,
    transformArg: null,
  }));
}

function valueOf(fields: ReadonlyArray<{ name: string; value: string }>, name: string): string | undefined {
  return fields.find((f) => f.name === name)?.value;
}

describe('feedPackQuantity — the smallest power of ten that makes a unit price exact to the grosz', () => {
  it.each([
    ['12.5000', 1],
    ['0.0100', 1],
    ['0', 1],
    ['0.0125', 100],
    ['0.0150', 10],
    ['9.0450', 10],
    ['1.5050', 10],
    ['0.00125', 1000],
    ['0.000001', 10_000],
  ] as const)('%s → %i', (amount, quantity) => {
    expect(feedPackQuantity(amount)).toBe(quantity);
  });

  it('answers null past the 10 000 cap', () => {
    expect(MAX_FEED_PACK_QUANTITY).toBe(10_000);
    expect(feedPackQuantity('0.0000001')).toBeNull();
  });
});

describe('Google Merchant Center publishes a sub-cent price as a multipack', () => {
  const fields = templateFields('google_merchant_v1');

  it('binds the multipack and unit-pricing fields in the predefined template', () => {
    expect(fields.map((f) => [f.outputName, f.sourceKind])).toEqual(
      expect.arrayContaining([
        ['g:multipack', 'pack_quantity'],
        ['g:unit_pricing_measure', 'pack_unit_pricing_measure'],
        ['g:unit_pricing_base_measure', 'pack_unit_pricing_base_measure'],
      ]),
    );
  });

  it('0.0125 net is 100 units at 1.25 net, 1.54 gross (the gross of the pack line, half-up)', () => {
    const gross = resolveFeedItem({ fields, item: ITEM, context: CONTEXT });
    expect(gross.skipped).toBe(false);
    expect(valueOf(gross.fields, 'g:price')).toBe('1.54 PLN');
    expect(valueOf(gross.fields, 'g:multipack')).toBe('100');
    expect(valueOf(gross.fields, 'g:unit_pricing_measure')).toBe('100ct');
    expect(valueOf(gross.fields, 'g:unit_pricing_base_measure')).toBe('100ct');

    const net = resolveFeedItem({ fields, item: ITEM, context: { ...CONTEXT, pricePresentation: 'net' } });
    expect(valueOf(net.fields, 'g:price')).toBe('1.25 PLN');
    expect(valueOf(net.fields, 'g:multipack')).toBe('100');
  });

  it('9.0450 is 10 units at 90.45 net, 111.25 gross', () => {
    const item = { ...ITEM, price: price('9.0450', '11.13') };
    expect(valueOf(resolveFeedItem({ fields, item, context: CONTEXT }).fields, 'g:price')).toBe('111.25 PLN');
    const net = resolveFeedItem({ fields, item, context: { ...CONTEXT, pricePresentation: 'net' } });
    expect(valueOf(net.fields, 'g:price')).toBe('90.45 PLN');
    expect(valueOf(net.fields, 'g:multipack')).toBe('10');
  });

  it('a gross feed with no tax rule packs the net, and still warns', () => {
    const item = { ...ITEM, price: price('0.0125', '0.0125', null) };
    const out = resolveFeedItem({ fields, item, context: CONTEXT });
    expect(valueOf(out.fields, 'g:price')).toBe('1.25 PLN');
    expect(out.issues).toContainEqual(expect.objectContaining({ reason: 'zero_tax_rate_on_gross_feed' }));
  });

  it('the sale price follows the same rule, and both prices are of the same pack', () => {
    const item = { ...ITEM, price: price('100.0000', '123.00'), salePrice: price('0.0150', '0.02') };
    const out = resolveFeedItem({ fields, item, context: { ...CONTEXT, pricePresentation: 'net' } });
    expect(out.skipped).toBe(false);
    expect(valueOf(out.fields, 'g:multipack')).toBe('10');
    expect(valueOf(out.fields, 'g:price')).toBe('1000.00 PLN');
    expect(valueOf(out.fields, 'g:sale_price')).toBe('0.15 PLN');
  });

  it('the larger pack wins when the price and the sale price need different ones', () => {
    const item = { ...ITEM, price: price('0.0150', '0.02'), salePrice: price('0.0125', '0.02') };
    const out = resolveFeedItem({ fields, item, context: { ...CONTEXT, pricePresentation: 'net' } });
    expect(valueOf(out.fields, 'g:multipack')).toBe('100');
    expect(valueOf(out.fields, 'g:price')).toBe('1.50 PLN');
    expect(valueOf(out.fields, 'g:sale_price')).toBe('1.25 PLN');
  });

  it('a pack above 100 keeps the multipack and omits the unit pricing, which Google cannot state per pack', () => {
    const item = { ...ITEM, price: price('0.00125', '0.00') };
    const out = resolveFeedItem({ fields, item, context: { ...CONTEXT, pricePresentation: 'net' } });
    expect(valueOf(out.fields, 'g:price')).toBe('1.25 PLN');
    expect(valueOf(out.fields, 'g:multipack')).toBe('1000');
    expect(valueOf(out.fields, 'g:unit_pricing_measure')).toBeUndefined();
    expect(valueOf(out.fields, 'g:unit_pricing_base_measure')).toBeUndefined();
  });

  it('skips the item, with a reason, when no pack of at most 10 000 is exact', () => {
    const item = { ...ITEM, price: price('0.0000001', '0.00') };
    const out = resolveFeedItem({ fields, item, context: CONTEXT });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toBe('sub_cent_price_beyond_pack_limit');
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'skip', reason: 'sub_cent_price_beyond_pack_limit', outputName: 'g:price' }),
    );
  });

  it('a two-place price emits no pack field at all', () => {
    const item = { ...ITEM, price: price('29.5000', '36.29') };
    const out = resolveFeedItem({ fields, item, context: CONTEXT });
    expect(valueOf(out.fields, 'g:price')).toBe('36.29 PLN');
    expect(out.fields.map((f) => f.name)).not.toEqual(
      expect.arrayContaining(['g:multipack']),
    );
  });
});

describe('a format with no pack field skips a sub-cent item and says why', () => {
  it.each(['meta_catalog_v1', 'amazon_flat_file_v1', 'ebay_v1', 'allegro_v1'])('%s', (systemCode) => {
    const out = resolveFeedItem({ fields: templateFields(systemCode), item: ITEM, context: CONTEXT });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toBe('sub_cent_price_without_pack_field');
    expect(out.fields).toEqual([]);
    const skip = out.issues.find((i) => i.severity === 'skip')!;
    expect(skip.reason).toBe('sub_cent_price_without_pack_field');
    expect(skip.detail).toContain('0.0125');
    expect(skip.detail).toContain('100');
  });

  it('a template that publishes no price has nothing to pack', () => {
    const out = resolveFeedItem({
      fields: templateFields('meta_catalog_v1').filter((f) => f.sourceKind !== 'price' && f.sourceKind !== 'sale_price'),
      item: ITEM,
      context: CONTEXT,
    });
    expect(out.skipped).toBe(false);
  });

  it('a single field resolved against the whole template packs as the template does (the editor preview)', () => {
    const whole = templateFields('google_merchant_v1');
    const priceField = whole.find((f) => f.sourceKind === 'price')!;
    const out = resolveFeedItem({ fields: [priceField], templateFields: whole, item: ITEM, context: CONTEXT });
    expect(out.skipped).toBe(false);
    expect(valueOf(out.fields, 'g:price')).toBe('1.54 PLN');
  });
});

describe('the field source catalogue offers the pack sources', () => {
  it('lists them with price and stock', () => {
    const group = buildFieldSourceCatalogue([]).groups.find((g) => g.kind === 'price_and_stock')!;
    expect(group.sources.map((s) => s.sourceKind)).toEqual(
      expect.arrayContaining(['pack_quantity', 'pack_unit_pricing_measure', 'pack_unit_pricing_base_measure']),
    );
  });
});
