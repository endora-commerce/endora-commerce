import { describe, expect, it } from 'vitest';
import { resolveFeedItem } from '../../../../packages/modules/product_feeds/src/backend/services/item-field-resolver.js';
import type {
  FeedItemSource,
  FeedResolutionContext,
  ResolvableTemplateField,
} from '../../../../packages/modules/product_feeds/src/backend/services/item-field-resolver.interface.js';

/**
 * Feature 067 / T023 — per-field resolution (FR-003, FR-037, FR-040–FR-045).
 *
 * `resolveFeedItem` is a pure function: template fields + one hydrated item +
 * the feed's resolution context in, the item's output fields and its issue list
 * out. Keeping it pure is what makes the whole fallback matrix testable with no
 * database, and it is the overlay seam a deployment replaces (Principle XV).
 */

const CONTEXT: FeedResolutionContext = {
  languageCode: 'pl-PL',
  languageFallbacks: ['pl', 'en-US'],
  currencyCode: 'PLN',
  pricePresentation: 'gross',
  taxCountry: 'PL',
  storefrontOrigin: 'https://shop.example.com',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  priceListId: null,
};

const ITEM: FeedItemSource = {
  productId: '11111111-1111-4111-8111-111111111111',
  variantId: null,
  sku: 'SKU-1',
  slug: 'blue-widget',
  productType: 'simple',
  name: { 'pl-PL': 'Niebieski widget', 'en-US': 'Blue widget' },
  description: { 'pl-PL': 'Opis', 'en-US': 'Description' },
  attributes: { brand: 'Acme', colour: 'blue', weight: 2.5 },
  customFields: { warranty_months: 24 },
  price: { net: 100, gross: 123, taxResolved: true },
  salePrice: null,
  inStock: true,
  stockQuantity: 7,
  imageUrls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
  privateImageCount: 0,
  categoryPath: ['Dom', 'Meble', 'Krzesła'],
  providerCategory: null,
  providerCategoryMissReason: null,
  groupingId: null,
};

function field(over: Partial<ResolvableTemplateField>): ResolvableTemplateField {
  return {
    outputName: 'out',
    sourceKind: 'sku',
    sourceKey: null,
    constantValue: null,
    fallbackValue: null,
    providerRequired: false,
    transform: null,
    transformArg: null,
    ...over,
  };
}

function valueOf(fields: ReadonlyArray<{ name: string; value: string }>, name: string) {
  return fields.find((f) => f.name === name)?.value;
}

describe('resolveFeedItem — every source kind (FR-003)', () => {
  const cases: Array<[ResolvableTemplateField, string | undefined]> = [
    [field({ outputName: 'a', sourceKind: 'product_id' }), ITEM.productId],
    [field({ outputName: 'a', sourceKind: 'sku' }), 'SKU-1'],
    [field({ outputName: 'a', sourceKind: 'name' }), 'Niebieski widget'],
    [field({ outputName: 'a', sourceKind: 'description' }), 'Opis'],
    [field({ outputName: 'a', sourceKind: 'slug' }), 'blue-widget'],
    [field({ outputName: 'a', sourceKind: 'product_type' }), 'simple'],
    [field({ outputName: 'a', sourceKind: 'brand' }), 'Acme'],
    [field({ outputName: 'a', sourceKind: 'attribute', sourceKey: 'colour' }), 'blue'],
    [
      field({ outputName: 'a', sourceKind: 'custom_field', sourceKey: 'warranty_months' }),
      '24',
    ],
    [field({ outputName: 'a', sourceKind: 'price' }), '123.00 PLN'],
    [field({ outputName: 'a', sourceKind: 'availability' }), 'in_stock'],
    [field({ outputName: 'a', sourceKind: 'stock_quantity' }), '7'],
    [
      field({ outputName: 'a', sourceKind: 'link' }),
      'https://shop.example.com/p/blue-widget?lang=pl-PL',
    ],
    [field({ outputName: 'a', sourceKind: 'image_link' }), 'https://cdn.example.com/a.jpg'],
    [
      field({ outputName: 'a', sourceKind: 'additional_image_link' }),
      'https://cdn.example.com/b.jpg',
    ],
    [field({ outputName: 'a', sourceKind: 'category_path' }), 'Dom > Meble > Krzesła'],
    [field({ outputName: 'a', sourceKind: 'grouping_id' }), ITEM.productId],
    [
      field({ outputName: 'a', sourceKind: 'constant', constantValue: 'new' }),
      'new',
    ],
  ];

  it.each(cases.map((c, i) => [i, c[0], c[1]] as const))(
    'case %i resolves %o',
    (_i, templateField, expected) => {
      const out = resolveFeedItem({ fields: [templateField], item: ITEM, context: CONTEXT });
      expect(out.skipped).toBe(false);
      expect(valueOf(out.fields, 'a')).toBe(expected);
    },
  );

  it('omits provider_category and KEEPS the item when nothing is mapped (FR-083)', () => {
    const out = resolveFeedItem({
      fields: [
        field({ outputName: 'g:id', sourceKind: 'sku' }),
        field({ outputName: 'g:google_product_category', sourceKind: 'provider_category' }),
      ],
      item: { ...ITEM, providerCategoryMissReason: 'unmapped_provider_category' },
      context: CONTEXT,
    });
    expect(out.skipped).toBe(false);
    expect(valueOf(out.fields, 'g:google_product_category')).toBeUndefined();
    expect(valueOf(out.fields, 'g:id')).toBe('SKU-1');
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'unmapped_provider_category' }),
    );
  });

  it('records the stale reason distinctly from the unmapped one (FR-085)', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'cat', sourceKind: 'provider_category' })],
      item: { ...ITEM, providerCategoryMissReason: 'stale_provider_category_mapping' },
      context: CONTEXT,
    });
    expect(out.issues).toContainEqual(
      expect.objectContaining({ reason: 'stale_provider_category_mapping' }),
    );
  });

  it('emits the mapped node when one resolved', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'cat', sourceKind: 'provider_category' })],
      item: { ...ITEM, providerCategory: '6362' },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'cat')).toBe('6362');
    expect(out.issues).toHaveLength(0);
  });

  it('skips the item when provider_category is required and unmapped (FR-083)', () => {
    const out = resolveFeedItem({
      fields: [
        field({
          outputName: 'cat',
          sourceKind: 'provider_category',
          providerRequired: true,
        }),
      ],
      item: { ...ITEM, providerCategoryMissReason: 'unmapped_provider_category' },
      context: CONTEXT,
    });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toBe('missing_required_field');
  });

  it('resolves sale_price only when one exists, and omits it otherwise', () => {
    const none = resolveFeedItem({
      fields: [field({ outputName: 'sale', sourceKind: 'sale_price' })],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(none.fields, 'sale')).toBeUndefined();

    const some = resolveFeedItem({
      fields: [field({ outputName: 'sale', sourceKind: 'sale_price' })],
      item: { ...ITEM, salePrice: { net: 80, gross: 98.4, taxResolved: true } },
      context: CONTEXT,
    });
    expect(valueOf(some.fields, 'sale')).toBe('98.40 PLN');
  });

  it('emits net prices when the feed says net (FR-044)', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'p', sourceKind: 'price' })],
      item: ITEM,
      context: { ...CONTEXT, pricePresentation: 'net', taxCountry: null },
    });
    expect(valueOf(out.fields, 'p')).toBe('100.00 PLN');
  });

  it('warns rather than silently emitting a zero-VAT price on a gross feed (R12)', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'p', sourceKind: 'price' })],
      item: { ...ITEM, price: { net: 100, gross: 100, taxResolved: false } },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'p')).toBe('100.00 PLN');
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'zero_tax_rate_on_gross_feed' }),
    );
  });

  it('maps availability to the out-of-stock vocabulary (FR-045)', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'a', sourceKind: 'availability' })],
      item: { ...ITEM, inStock: false },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'a')).toBe('out_of_stock');
  });
});

describe('resolveFeedItem — identity defaults (FR-041)', () => {
  it('defaults the item id to the SKU', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'g:id', sourceKind: 'sku' })],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'g:id')).toBe('SKU-1');
  });

  it('uses the variant SKU for a variant-granularity item', () => {
    const out = resolveFeedItem({
      fields: [
        field({ outputName: 'g:id', sourceKind: 'sku' }),
        field({ outputName: 'g:item_group_id', sourceKind: 'grouping_id' }),
      ],
      item: { ...ITEM, variantId: 'v-1', sku: 'SKU-1-RED', groupingId: ITEM.productId },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'g:id')).toBe('SKU-1-RED');
    // The grouping id ties one product's variants together.
    expect(valueOf(out.fields, 'g:item_group_id')).toBe(ITEM.productId);
  });
});

describe('resolveFeedItem — link (FR-042)', () => {
  it('builds the link from the channel storefront origin, /p/<slug> and ?lang=', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'link', sourceKind: 'link' })],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'link')).toBe(
      'https://shop.example.com/p/blue-widget?lang=pl-PL',
    );
  });

  it('never emits a double slash when the origin carries a trailing slash', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'link', sourceKind: 'link' })],
      item: ITEM,
      context: { ...CONTEXT, storefrontOrigin: 'https://shop.example.com/' },
    });
    expect(valueOf(out.fields, 'link')).toBe(
      'https://shop.example.com/p/blue-widget?lang=pl-PL',
    );
  });

  it('records unresolvable_link and omits the field when no storefront origin is configured', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'link', sourceKind: 'link' })],
      item: ITEM,
      context: { ...CONTEXT, storefrontOrigin: '' },
    });
    expect(valueOf(out.fields, 'link')).toBeUndefined();
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'unresolvable_link' }),
    );
  });
});

describe('resolveFeedItem — images (FR-043)', () => {
  it('omits the image and never emits a signed URL when no public image exists', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'image_link', sourceKind: 'image_link' })],
      item: { ...ITEM, imageUrls: [], privateImageCount: 0 },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'image_link')).toBeUndefined();
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'missing_image' }),
    );
  });

  it('records private_image_asset when the product only has non-public images', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'image_link', sourceKind: 'image_link' })],
      item: { ...ITEM, imageUrls: [], privateImageCount: 3 },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'image_link')).toBeUndefined();
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'private_image_asset' }),
    );
    // The whole point: no expiring signed URL leaks into a public file.
    expect(JSON.stringify(out.fields)).not.toContain('token=');
  });

  it('emits the remaining images, comma-joined, for additional_image_link', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'extra', sourceKind: 'additional_image_link' })],
      item: { ...ITEM, imageUrls: ['a', 'b', 'c'] },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'extra')).toBe('b,c');
  });
});

describe('resolveFeedItem — fallbacks and required fields (FR-002, FR-037)', () => {
  it('uses the fallback when the source resolves empty', () => {
    const out = resolveFeedItem({
      fields: [
        field({
          outputName: 'brand',
          sourceKind: 'attribute',
          sourceKey: 'missing_key',
          fallbackValue: 'Acme',
        }),
      ],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'brand')).toBe('Acme');
    expect(out.skipped).toBe(false);
  });

  it('does NOT use the fallback when the source resolved to a real value', () => {
    const out = resolveFeedItem({
      fields: [
        field({
          outputName: 'brand',
          sourceKind: 'attribute',
          sourceKey: 'brand',
          fallbackValue: 'Fallback',
        }),
      ],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'brand')).toBe('Acme');
  });

  it('skips the item with missing_required_field when required, sourceless and fallbackless', () => {
    const out = resolveFeedItem({
      fields: [
        field({ outputName: 'g:id', sourceKind: 'sku' }),
        field({
          outputName: 'g:gtin',
          sourceKind: 'attribute',
          sourceKey: 'gtin',
          providerRequired: true,
        }),
      ],
      item: ITEM,
      context: CONTEXT,
    });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toBe('missing_required_field');
    expect(out.issues).toContainEqual(
      expect.objectContaining({
        severity: 'skip',
        reason: 'missing_required_field',
        outputName: 'g:gtin',
      }),
    );
  });

  it('does not skip when a required field is satisfied by its fallback', () => {
    const out = resolveFeedItem({
      fields: [
        field({
          outputName: 'g:condition',
          sourceKind: 'attribute',
          sourceKey: 'condition',
          providerRequired: true,
          fallbackValue: 'new',
        }),
      ],
      item: ITEM,
      context: CONTEXT,
    });
    expect(out.skipped).toBe(false);
    expect(valueOf(out.fields, 'g:condition')).toBe('new');
  });

  it('skips with missing_price when a required price cannot be resolved', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'g:price', sourceKind: 'price', providerRequired: true })],
      item: { ...ITEM, price: null },
      context: CONTEXT,
    });
    expect(out.skipped).toBe(true);
    expect(out.issues.some((i) => i.reason === 'missing_price')).toBe(true);
  });

  it('omits an optional empty field rather than writing a blank one', () => {
    const out = resolveFeedItem({
      fields: [
        field({ outputName: 'g:id', sourceKind: 'sku' }),
        field({ outputName: 'g:gtin', sourceKind: 'attribute', sourceKey: 'gtin' }),
      ],
      item: ITEM,
      context: CONTEXT,
    });
    expect(out.skipped).toBe(false);
    expect(out.fields.map((f) => f.name)).toEqual(['g:id']);
  });
});

describe('resolveFeedItem — language chain (FR-040)', () => {
  it('uses the feed language when present, with no warning', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'title', sourceKind: 'name' })],
      item: ITEM,
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'title')).toBe('Niebieski widget');
    expect(out.issues).toHaveLength(0);
  });

  it('walks the configured fallback chain and counts the substitution as a warning', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'title', sourceKind: 'name' })],
      item: { ...ITEM, name: { pl: 'Zapasowy', 'en-US': 'English' } },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'title')).toBe('Zapasowy');
    expect(out.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', reason: 'missing_translation' }),
    );
  });

  it('falls through to the platform default at the end of the chain', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'title', sourceKind: 'name' })],
      item: { ...ITEM, name: { 'en-US': 'English only' } },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'title')).toBe('English only');
    expect(out.issues.some((i) => i.reason === 'missing_translation')).toBe(true);
  });

  it('records at most one missing_translation warning per field', () => {
    const out = resolveFeedItem({
      fields: [
        field({ outputName: 'title', sourceKind: 'name' }),
        field({ outputName: 'description', sourceKind: 'description' }),
      ],
      item: { ...ITEM, name: { 'en-US': 'x' }, description: { 'en-US': 'y' } },
      context: CONTEXT,
    });
    expect(out.issues.filter((i) => i.reason === 'missing_translation')).toHaveLength(2);
  });
});

describe('resolveFeedItem — transforms (FR-067)', () => {
  it('applies the closed transform list', () => {
    const cases: Array<[ResolvableTemplateField['transform'], string | null, string]> = [
      ['upper', null, 'NIEBIESKI WIDGET'],
      ['lower', null, 'niebieski widget'],
      ['truncate', '9', 'Niebieski'],
    ];
    for (const [transform, transformArg, expected] of cases) {
      const out = resolveFeedItem({
        fields: [field({ outputName: 't', sourceKind: 'name', transform, transformArg })],
        item: ITEM,
        context: CONTEXT,
      });
      expect(valueOf(out.fields, 't')).toBe(expected);
    }
  });

  it('strips HTML and collapses the leftover whitespace', () => {
    const out = resolveFeedItem({
      fields: [field({ outputName: 'd', sourceKind: 'description', transform: 'strip_html' })],
      item: { ...ITEM, description: { 'pl-PL': '<p>Opis <b>x</b></p>' } },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'd')).toBe('Opis x');
  });

  it('makes a relative URL absolute against the storefront origin', () => {
    const out = resolveFeedItem({
      fields: [
        field({
          outputName: 'u',
          sourceKind: 'attribute',
          sourceKey: 'manual',
          transform: 'absolute_url',
        }),
      ],
      item: { ...ITEM, attributes: { ...ITEM.attributes, manual: '/files/manual.pdf' } },
      context: CONTEXT,
    });
    expect(valueOf(out.fields, 'u')).toBe('https://shop.example.com/files/manual.pdf');
  });
});
