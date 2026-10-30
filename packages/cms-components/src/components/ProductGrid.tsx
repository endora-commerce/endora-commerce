'use client';

import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import {
  createToggleField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import type { BreakpointTier, ResponsiveProp } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ProductGridProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CmsProductCardView } from './CmsProductCard.js';
import { CAROUSEL_HEADER_FIELDS, CarouselHeaderBlock } from './carousel/carousel-parts.js';
import { LISTING_LEAD_FIELDS, listingLeadOptions } from './listing-lead.js';
import {
  PRODUCT_LISTING_CARD_FIELDS,
  PRODUCT_LISTING_FOOTER_FIELDS,
  ProductListingFooter,
  listingCardVariant,
  listingCardTextLine,
  listingCardTitleWeight,
  listingCardLook,
  withoutUnusedCardFields,
  listingCtaLabel,
} from './catalog/product-listing-parts.js';
import { gapCss, numericGapAsCustom, usesCustom } from './section-parts.js';
import { GAP_OPTIONS, gapPxField } from '../fields/section-block-fields.js';
import { useBlockData } from '../hooks/use-block-data.js';
import { productSourceDataRequest } from '../utils/block-data.js';
import { estimateProductGridSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { ProductGridSkeleton } from './catalog/CatalogSkeletons.js';
import { resolveProductSourceFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';

function ProductGridBody({
  props,
  tier,
  editing,
}: {
  props: ProductGridProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement | null {
  const {
    source = 'manual',
    productSlugs = [],
    categorySlug = '',
    searchQuery = '',
    limit = 12,
    columns = 4,
    gap = 16,
    gapPx: storedGapPx,
    view = 'grid',
    equalItemHeight = true,
    puck: _puck,
    header: _header,
    headingLevel: _headingLevel,
    headingSize: _headingSize,
    headingSizePx: _headingSizePx,
    headingWeight: _headingWeight,
    headingMaxWidth: _headingMaxWidth,
    headingMaxWidthPx: _headingMaxWidthPx,
    cardVariant: _cardVariant,
    cardTextLine: _cardTextLine,
    cardTitleWeight: _cardTitleWeight,
    cardImageBackground: _cardImageBackground,
    cardDivider: _cardDivider,
    cardDividerColor: _cardDividerColor,
    ctaLabel: _ctaLabel,
    footerButton: _footerButton,
    footerButtonAlign: _footerButtonAlign,
    leadSize: _leadSize,
    leadSizePx: _leadSizePx,
    leadWeight: _leadWeight,
    leadColor: _leadColor,
    ...box
  } = props;
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading: isLoading, data } = useBlockData<CmsProductSummary[]>(
    productSourceDataRequest({ source, productSlugs, categorySlug, searchQuery, limit }),
    { holdSkeleton: true },
  );
  const products = data ?? [];
  const colCount = resolveResponsiveNumber(columns, tier, 4);
  // R17 (T207): a size or a Custom px per breakpoint; a stored number is today's px gap.
  const gapLength = gapCss(gap as never, storedGapPx, 16, tier);
  const gapPx = Number(/(\d+(?:\.\d+)?)px\)?$/.exec(gapLength)?.[1] ?? 16);
  // R17 (T219): equal heights per breakpoint; a stored boolean is every breakpoint's.
  const equalHeights = resolveResponsive<boolean>(equalItemHeight as boolean | ResponsiveProp<boolean>, tier, true);
  const gridView = resolveResponsive(view, tier, 'grid');

  if (isLoading) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <ProductGridSkeleton
          count={estimateProductGridSkeletonCount(source, productSlugs, limit, colCount)}
          columns={colCount}
          gap={gapPx}
        />
      </BoxStyled>
    );
  }

  if (products.length === 0) {
    // Feature 169 (FR-003): shoppers see nothing of an empty listing; the editor explains why it is empty.
    if (!editing) return null;
    return (
      <BoxStyled {...box} previewTier={tier}>
        <p className="cmsc-pb-product-grid__empty">
          {source === 'category' && !categorySlug
            ? 'Select a category in the sidebar to preview products.'
            : source === 'category'
              ? 'No products in this category (or none visible for preview).'
              : source === 'query' && !searchQuery
                ? 'Enter a search query in the sidebar to preview products.'
                : 'No products to preview — configure the source in the sidebar.'}
        </p>
      </BoxStyled>
    );
  }

  const listClass = [
    gridView === 'list' ? 'cmsc-pb-product-grid cmsc-pb-product-grid--list' : 'cmsc-pb-product-grid',
    equalHeights ? 'cmsc-pb-product-grid--equal-height' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Today's list view shows the horizontal card; a chosen style wins in either view.
  const variant = listingCardVariant(props, gridView === 'list' ? 'horizontal' : 'default');
  const headerTier = editing ? tier : null;
  const leadOptions = listingLeadOptions(props, headerTier);

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      {/* R21G (T338): the lead's own look, when one is chosen. */}
      <CarouselHeaderBlock props={props} tier={headerTier} {...(leadOptions ? { options: leadOptions } : {})} />
      <ul
        className={listClass}
        style={{
          gap: gapLength,
          gridTemplateColumns: gridView === 'grid' ? `repeat(${colCount}, minmax(0, 1fr))` : undefined,
        }}
      >
        {products.map((p) => (
          <li key={p.id}>
            <CmsProductCardView product={p} variant={variant} {...listingCardTextLine(props)} {...listingCardTitleWeight(props)} {...listingCardLook(props)} {...listingCtaLabel(props)} />
          </li>
        ))}
      </ul>
      <ProductListingFooter props={props} tier={headerTier} />
    </BoxStyled>
  );
}

const ProductGridEditingRender: PuckComponent<ProductGridProps> = (props) => (
  <ProductGridBody props={props as unknown as ProductGridProps} tier={usePreviewBreakpointTier()} editing />
);

const ProductGridPublishedRender: PuckComponent<ProductGridProps> = (props) => (
  <ProductGridBody props={props as unknown as ProductGridProps} tier={useViewportBreakpointTier()} editing={false} />
);

const productGridConfig: ComponentConfig<ProductGridProps> = {
  label: 'Product grid',
  fields: {
    source: {
      type: 'select',
      label: 'Source',
      metadata: CATALOG_DATA_FIELD_META,
      options: [
        { label: 'Manual selection', value: 'manual' },
        { label: 'Category', value: 'category' },
        { label: 'Search query', value: 'query' },
      ],
    },
    productSlugs: createCatalogSlugsFallbackField('Products'),
    categorySlug: createCatalogSlugFallbackField('Category'),
    searchQuery: { type: 'text', label: 'Search query', metadata: CATALOG_DATA_FIELD_META },
    limit: { type: 'number', label: 'Limit', min: 1, max: 24, metadata: CATALOG_DATA_FIELD_META },
    columns: { type: 'number', label: 'Columns', min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA },
    view: {
      type: 'select',
      label: 'View',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Grid', value: 'grid' },
        { label: 'List', value: 'list' },
      ],
    },
    // R17 (T219): with the columns and the view, per breakpoint.
    equalItemHeight: createToggleField({ label: 'Equal items height', defaultValue: true, metadata: PB_RESPONSIVE_METADATA }) as never,
    // R17 (T207): the gap as every other block's — a size or a Custom px, per breakpoint.
    gap: { type: 'select', label: 'Gap', metadata: PB_RESPONSIVE_METADATA, options: GAP_OPTIONS },
    gapPx: { ...gapPxField('Custom gap (px)'), max: 48 },
    ...CAROUSEL_HEADER_FIELDS,
    // R21G (T338): the header lead's size, weight and colour.
    ...LISTING_LEAD_FIELDS,
    ...PRODUCT_LISTING_CARD_FIELDS,
    ...PRODUCT_LISTING_FOOTER_FIELDS,
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  } as unknown as Fields<ProductGridProps>,
  defaultProps: {
    source: 'manual',
    productSlugs: [],
    categorySlug: '',
    searchQuery: '',
    limit: 12,
    columns: 4,
    gap: 'custom',
    gapPx: 16,
    view: 'grid',
    equalItemHeight: true,
    headingLevel: 'h2',
    headingSize: 'h3',
    cardVariant: 'default',
    ctaLabel: '',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ProductGridEditingRender {...props} /> : <ProductGridPublishedRender {...props} />,
  // R17 (T207): a gap stored as a number reads as Custom with that px (the render is the same).
  resolveData: ({ props }) => {
    const carried = numericGapAsCustom(props.gap, props.gapPx);
    return { props: (carried ? { ...props, ...carried } : props) as never };
  },
  resolveFields: (data, { fields }) => {
    const resolved = resolveProductSourceFields(fields as never, data.props.source ?? 'manual') as Record<string, unknown>;
    if (!usesCustom(numericGapAsCustom(data.props.gap, data.props.gapPx)?.gap ?? data.props.gap)) delete resolved['gapPx'];
    if (!usesCustom(data.props.headingSize)) delete resolved['headingSizePx'];
    // R23 (T435): the heading's line height with a Custom px size only.
    if (!usesCustom(data.props.headingSize)) delete resolved['headingLineHeight'];
    if (!usesCustom(data.props.headingMaxWidth)) delete resolved['headingMaxWidthPx'];
    if (!usesCustom(data.props.leadSize)) delete resolved['leadSizePx'];
    withoutUnusedCardFields(resolved, data.props);
    return resolved as typeof fields;
  },
};

/**
 * Feature 163 (T071, contracts/blocks.md): every option of today's grid is
 * kept as it was; the header, the card style (with `showcase`), the card link
 * label and a footer button are additions; a stored grid renders as today.
 */
export const ProductGrid = withHideOn(productGridConfig);
