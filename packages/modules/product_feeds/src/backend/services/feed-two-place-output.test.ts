import { describe, expect, it } from 'vitest';
import { PREDEFINED_TEMPLATES } from '../seeds/predefined-templates.js';
import { resolveFeedItem } from './item-field-resolver.js';
import type {
  FeedItemSource,
  FeedResolutionContext,
  ResolvableTemplateField,
} from './item-field-resolver.interface.js';
import { DelimitedFeedSerializer } from './serializers/delimited-feed-serializer.js';
import type { FeedSerializer } from './serializers/serializer.interface.js';
import { XmlFeedSerializer } from './serializers/xml-feed-serializer.js';

/**
 * Issue #430 — a price with two significant places is published exactly as it
 * was before sub-cent prices learned to travel as a pack: these files were
 * recorded on `master` before the change, byte for byte, through every
 * predefined template. The pack fields a template gained resolve to nothing for
 * such an item, so they are omitted and the file does not move.
 */

const BASE: Omit<FeedItemSource, 'price' | 'salePrice' | 'sku' | 'productId'> = {
  variantId: null,
  slug: 'blue-widget',
  productType: 'simple',
  name: 'Niebieski widget',
  description: 'Opis',
  attributes: { brand: 'Acme', gtin: '5901234123457' },
  customFields: {},
  inStock: true,
  stockQuantity: 7,
  imageUrls: ['https://cdn.example.com/a.jpg'],
  privateImageCount: 0,
  categoryPath: ['Dom', 'Meble'],
  providerCategory: '443',
  providerCategoryMissReason: null,
  groupingId: null,
};

/** Net and gross (23 %) as the hydrator answers them — two significant places each. */
const ITEMS: FeedItemSource[] = [
  {
    ...BASE,
    productId: 'p-1',
    sku: 'SKU-1',
    price: { net: '29.5000', gross: '36.29', taxResolved: true, taxRatePercent: 23 },
    salePrice: null,
  },
  {
    ...BASE,
    productId: 'p-2',
    sku: 'SKU-2',
    price: { net: '100.0000', gross: '123.00', taxResolved: true, taxRatePercent: 23 },
    salePrice: { net: '80.1000', gross: '98.52', taxResolved: true, taxRatePercent: 23 },
  },
  {
    ...BASE,
    productId: 'p-3',
    sku: 'SKU-3',
    price: { net: '0.0100', gross: '0.01', taxResolved: true, taxRatePercent: 23 },
    salePrice: null,
  },
];

function context(pricePresentation: 'gross' | 'net'): FeedResolutionContext {
  return {
    languageCode: 'pl-PL',
    languageFallbacks: [],
    currencyCode: 'PLN',
    pricePresentation,
    taxCountry: 'PL',
    storefrontOrigin: 'https://shop.example.com',
    // Feature 167 — the channel's URL-language facts: links carry the language prefix.
    channelUrl: { languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true },
    salesChannelId: 'channel-1',
    priceListId: null,
  };
}

function render(systemCode: string, pricePresentation: 'gross' | 'net'): string {
  const template = PREDEFINED_TEMPLATES.find((t) => t.systemCode === systemCode)!;
  const fields: ResolvableTemplateField[] = template.fields.map((f) => ({
    outputName: f.outputName,
    sourceKind: f.sourceKind,
    sourceKey: f.sourceKey ?? null,
    constantValue: f.constantValue ?? null,
    fallbackValue: f.fallbackValue ?? null,
    providerRequired: f.providerRequired ?? false,
    transform: null,
    transformArg: null,
  }));
  const columns = fields.map((f) => f.outputName);
  const serializer: FeedSerializer =
    template.outputFormat === 'xml'
      ? new XmlFeedSerializer({ title: 'Shop', link: 'https://shop.example.com', description: 'Feed' })
      : template.outputFormat === 'tsv'
        ? new DelimitedFeedSerializer({ columns, delimiter: '\t', flavour: 'tsv' })
        : new DelimitedFeedSerializer({ columns, delimiter: ',', flavour: 'csv' });
  let out = serializer.begin();
  for (const item of ITEMS) {
    const resolved = resolveFeedItem({ fields, item, context: context(pricePresentation) });
    expect(resolved.skipped).toBe(false);
    out += serializer.item(resolved.fields);
  }
  return out + serializer.end();
}

describe('a two-place price is published byte for byte as before (issue #430)', () => {
  it.each([
    ['google_merchant_v1', 'gross'],
    ['google_merchant_v1', 'net'],
    ['meta_catalog_v1', 'gross'],
    ['amazon_flat_file_v1', 'gross'],
    ['ebay_v1', 'net'],
    ['allegro_v1', 'gross'],
  ] as const)('%s, %s', (systemCode, presentation) => {
    expect(render(systemCode, presentation)).toBe(GOLDEN[`${systemCode}:${presentation}`]);
  });
});

/** Recorded on `master` at 9e43c3412, before the change. Do not re-record: a diff here is the regression. */
const GOLDEN: Record<string, string> = {
  'google_merchant_v1:gross': `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Shop</title>
<link>https://shop.example.com</link>
<description>Feed</description>
<item>
<g:id>SKU-1</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>36.29 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-1</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-2</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>123.00 PLN</g:price>
<g:sale_price>98.52 PLN</g:sale_price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-2</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-3</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>0.01 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-3</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
</channel>
</rss>
`,
  'google_merchant_v1:net': `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Shop</title>
<link>https://shop.example.com</link>
<description>Feed</description>
<item>
<g:id>SKU-1</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>29.50 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-1</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-2</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>100.00 PLN</g:price>
<g:sale_price>80.10 PLN</g:sale_price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-2</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-3</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>0.01 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:gtin>5901234123457</g:gtin>
<g:item_group_id>p-3</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
</channel>
</rss>
`,
  'meta_catalog_v1:gross': `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Shop</title>
<link>https://shop.example.com</link>
<description>Feed</description>
<item>
<g:id>SKU-1</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>36.29 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:item_group_id>p-1</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-2</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>123.00 PLN</g:price>
<g:sale_price>98.52 PLN</g:sale_price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:item_group_id>p-2</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
<item>
<g:id>SKU-3</g:id>
<g:title>Niebieski widget</g:title>
<g:description>Opis</g:description>
<g:link>https://shop.example.com/pl/p/blue-widget</g:link>
<g:image_link>https://cdn.example.com/a.jpg</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>0.01 PLN</g:price>
<g:brand>Acme</g:brand>
<g:condition>new</g:condition>
<g:item_group_id>p-3</g:item_group_id>
<g:product_type>Dom &gt; Meble</g:product_type>
<g:google_product_category>443</g:google_product_category>
</item>
</channel>
</rss>
`,
  'amazon_flat_file_v1:gross': `sku\ttitle\tdescription\tprice\tavailability\tlink\timage_link\r
SKU-1\tNiebieski widget\tOpis\t36.29 PLN\tin_stock\thttps://shop.example.com/pl/p/blue-widget\thttps://cdn.example.com/a.jpg\r
SKU-2\tNiebieski widget\tOpis\t123.00 PLN\tin_stock\thttps://shop.example.com/pl/p/blue-widget\thttps://cdn.example.com/a.jpg\r
SKU-3\tNiebieski widget\tOpis\t0.01 PLN\tin_stock\thttps://shop.example.com/pl/p/blue-widget\thttps://cdn.example.com/a.jpg\r
`,
  'ebay_v1:net': `sku,title,description,price,availability,link,image_link\r
SKU-1,Niebieski widget,Opis,29.50 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
SKU-2,Niebieski widget,Opis,100.00 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
SKU-3,Niebieski widget,Opis,0.01 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
`,
  'allegro_v1:gross': `sku,title,description,price,availability,link,image_link\r
SKU-1,Niebieski widget,Opis,36.29 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
SKU-2,Niebieski widget,Opis,123.00 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
SKU-3,Niebieski widget,Opis,0.01 PLN,in_stock,https://shop.example.com/pl/p/blue-widget,https://cdn.example.com/a.jpg\r
`,
};
