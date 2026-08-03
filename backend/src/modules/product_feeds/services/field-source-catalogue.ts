import type { FeedFieldSourceCatalogue, FeedFieldSourceGroupKind } from '@b2b/contracts';

/**
 * The guided binding catalogue — feature 067 / FR-070.
 *
 * This is the list the editor's source picker renders, and it is the reason an
 * operator never types an internal key, a column name or a path. Two rules
 * govern what goes in it:
 *
 *  - **only what exists on this installation**: the platform-owned sources are
 *    fixed, the attribute/custom-field ones are built from the product-host
 *    definitions (one registry since feature 061);
 *  - **nothing is silently missing**: a source the chosen output format cannot
 *    express, or one that needs a taxonomy the template does not declare, is
 *    still listed — the editor renders it disabled with the reason. Filtering
 *    it out would leave the operator wondering where it went.
 *
 * Group order is likely-use order, not alphabetical (ux-design §3.2).
 */

/** One product-host definition, as the custom-fields registry hands it over. */
export interface ProductFieldDefinition {
  key: string;
  label: string;
  description: string | null;
  valueType: string;
}

interface PlatformSource {
  sourceKind: string;
  labelKey: string;
  requiresTaxonomy?: boolean;
  /** Formats that cannot express this source (a CSV column holds one value). */
  unsupportedInFormats?: Array<'xml' | 'csv' | 'tsv'>;
}

const PRODUCT_PROPERTIES: PlatformSource[] = [
  { sourceKind: 'name', labelKey: 'fieldSource.name' },
  { sourceKind: 'sku', labelKey: 'fieldSource.sku' },
  { sourceKind: 'description', labelKey: 'fieldSource.description' },
  { sourceKind: 'link', labelKey: 'fieldSource.link' },
  { sourceKind: 'image_link', labelKey: 'fieldSource.imageLink' },
  {
    sourceKind: 'additional_image_link',
    labelKey: 'fieldSource.additionalImageLink',
    // Several URLs in one delimited column would be unreadable to the provider.
    unsupportedInFormats: ['csv', 'tsv'],
  },
  { sourceKind: 'category_path', labelKey: 'fieldSource.categoryPath' },
  { sourceKind: 'product_type', labelKey: 'fieldSource.productType' },
  { sourceKind: 'brand', labelKey: 'fieldSource.brand' },
  { sourceKind: 'slug', labelKey: 'fieldSource.slug' },
  { sourceKind: 'product_id', labelKey: 'fieldSource.productId' },
  { sourceKind: 'grouping_id', labelKey: 'fieldSource.groupingId' },
];

const PRICE_AND_STOCK: PlatformSource[] = [
  { sourceKind: 'price', labelKey: 'fieldSource.price' },
  { sourceKind: 'sale_price', labelKey: 'fieldSource.salePrice' },
  { sourceKind: 'availability', labelKey: 'fieldSource.availability' },
  { sourceKind: 'stock_quantity', labelKey: 'fieldSource.stockQuantity' },
];

const COMPUTED: PlatformSource[] = [
  { sourceKind: 'provider_category', labelKey: 'fieldSource.providerCategory', requiresTaxonomy: true },
];

const CONSTANT: PlatformSource[] = [
  { sourceKind: 'constant', labelKey: 'fieldSource.constant' },
];

function platformGroup(
  kind: FeedFieldSourceGroupKind,
  sources: PlatformSource[],
): FeedFieldSourceCatalogue['groups'][number] {
  return {
    kind,
    sources: sources.map((source) => ({
      sourceKind: source.sourceKind as FeedFieldSourceCatalogue['groups'][number]['sources'][number]['sourceKind'],
      sourceKey: null,
      labelKey: source.labelKey,
      label: null,
      description: null,
      valueType: null,
      requiresTaxonomy: source.requiresTaxonomy ?? false,
      unsupportedInFormats: source.unsupportedInFormats ?? [],
    })),
  };
}

export function buildFieldSourceCatalogue(
  definitions: ProductFieldDefinition[],
): FeedFieldSourceCatalogue {
  const groups: FeedFieldSourceCatalogue['groups'] = [
    platformGroup('product_property', PRODUCT_PROPERTIES),
    platformGroup('price_and_stock', PRICE_AND_STOCK),
    platformGroup('computed', COMPUTED),
  ];

  // ux-design §3.2 asks for two groups, "Attributes" and "Custom fields",
  // because the operator's mental model separates them. Since feature 061 the
  // platform has ONE registry and the only discriminator is the catalog's
  // `product_attributes` extension table — which this module may not read
  // (Principle I). Splitting on a guess would mislabel fields, so they ship as
  // one group, exactly as the criteria panel already labels them.
  if (definitions.length > 0) {
    groups.push({
      kind: 'attribute',
      sources: definitions.map((definition) => ({
        sourceKind: 'attribute' as const,
        sourceKey: definition.key,
        labelKey: null,
        label: definition.label,
        description: definition.description,
        valueType: definition.valueType,
        requiresTaxonomy: false,
        unsupportedInFormats: [],
      })),
    });
  }

  groups.push(platformGroup('constant', CONSTANT));
  return { groups };
}
