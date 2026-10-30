'use client';

import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import { resolveResponsiveNumber, withHideOn, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import { useEditorCarouselPage } from '@endora-commerce/page-builder-core/editor/carousel-preview';
import type { BreakpointTier } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ProductSliderProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CmsProductCardView } from './CmsProductCard.js';
import { CarouselShell } from './carousel/CarouselShell.js';
import {
  CAROUSEL_HEADER_FIELDS,
  CAROUSEL_TRACK_FIELDS,
  carouselHeaderNode,
  carouselShellOptions,
  carouselPlacementMoved,
  withoutUnusedCarouselFields,
} from './carousel/carousel-parts.js';
import { LISTING_LEAD_FIELDS, listingLeadOptions } from './listing-lead.js';
import { ProductSliderSkeleton } from './catalog/CatalogSkeletons.js';
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
import { contentSliderFromLegacy } from './ContentSlider.js';
import { useBlockData } from '../hooks/use-block-data.js';
import { productSourceDataRequest } from '../utils/block-data.js';
import { estimateProductSliderSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { resolveProductSourceFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';
import { usesCustom } from './section-parts.js';

/**
 * `catalog.ProductSlider` — feature 163 (T071, contracts/blocks.md, research
 * R-12, R-16): the product source of today, shown in the one Carousel with its
 * options (slides per view with fractions, a spacing-token gap with today's px
 * as **Custom**, slide or fade, arrows and dots with a placement, a bleed,
 * autoplay), under an optional header, with a card style and a button below.
 *
 * Plan § *Extend, don't narrow*: every option of today's slider is kept. A
 * slider stored before is carried by {@link productSliderFromLegacy} —
 * `showArrows`/`showDots` become `controls` with today's placement (arrows
 * over the edges, dots below) and a px `gap` its Custom case — so it renders
 * as today.
 */

/** Today's slides per view, the new slider's default too. */
const DEFAULT_SLIDES_PER_VIEW = { base: 1, tablet: 4, desktop: 8 };

/** A slider stored before feature 163, in the Carousel's shape, value for value. Idempotent. */
export function productSliderFromLegacy<T extends Record<string, unknown>>(props: T): T & ProductSliderProps {
  return contentSliderFromLegacy(props) as unknown as T & ProductSliderProps;
}

function ProductSliderBody({
  props: raw,
  tier,
  editing,
  previewPage = 0,
}: {
  props: ProductSliderProps & { id?: string; puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
  previewPage?: number;
}): React.ReactElement | null {
  const props = productSliderFromLegacy(raw as unknown as Record<string, unknown>) as ProductSliderProps & {
    id?: string;
  };
  const {
    source = 'manual',
    productSlugs = [],
    categorySlug = '',
    searchQuery = '',
    limit = 12,
    slidesPerView = DEFAULT_SLIDES_PER_VIEW,
  } = props;
  const box = {
    ...(props.margin !== undefined ? { margin: props.margin } : {}),
    ...(props.padding !== undefined ? { padding: props.padding } : {}),
    ...(props.border !== undefined ? { border: props.border } : {}),
  };
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading: isLoading, data } = useBlockData<CmsProductSummary[]>(
    productSourceDataRequest({ source, productSlugs, categorySlug, searchQuery, limit }),
    { holdSkeleton: true },
  );
  const products = data ?? [];
  const perViewFallback = tier === 'desktop' ? 8 : tier === 'tablet' ? 4 : 1;
  const perView = resolveResponsiveNumber(slidesPerView, tier, perViewFallback);
  const carouselId = typeof props.id === 'string' ? props.id : undefined;

  if (isLoading) {
    const skeletonGap = typeof props.gapPx === 'number' || typeof props.gapPx === 'object' ? props.gapPx : 16;
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <ProductSliderSkeleton
          count={estimateProductSliderSkeletonCount(source, productSlugs, limit, perView)}
          slidesPerView={slidesPerView}
          gap={skeletonGap as number | ResponsiveProp<number>}
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

  const headerTier = editing ? tier : null;
  const variant = listingCardVariant(props, 'default');
  const label = typeof props.header?.heading === 'string' ? props.header.heading : undefined;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <CarouselShell
        {...carouselShellOptions(props, { slidesPerView: DEFAULT_SLIDES_PER_VIEW, intervalMs: 5000 })}
        // R21G (T338): the lead's own look, when one is chosen.
        header={carouselHeaderNode(props, headerTier, listingLeadOptions(props, headerTier))}
        {...(label ? { label } : {})}
        editorPreview={editing}
        previewPage={editing ? previewPage : 0}
        {...(editing ? { previewTier: tier } : {})}
        {...(editing && carouselId !== undefined ? { editorCarouselId: carouselId } : {})}
        {...(carouselId ? { instanceId: carouselId } : {})}
      >
        {products.map((p) => (
          <CmsProductCardView key={p.id} product={p} variant={variant} {...listingCardTextLine(props)} {...listingCardTitleWeight(props)} {...listingCardLook(props)} {...listingCtaLabel(props)} />
        ))}
      </CarouselShell>
      <ProductListingFooter props={props} tier={headerTier} />
    </BoxStyled>
  );
}

const ProductSliderEditingRender: PuckComponent<ProductSliderProps> = (props) => {
  const carouselId = (props as ProductSliderProps & { id?: string }).id;
  const previewPage = useEditorCarouselPage(carouselId);
  return <ProductSliderBody props={props as unknown as ProductSliderProps} tier={usePreviewBreakpointTier()} editing previewPage={previewPage} />;
};

const ProductSliderPublishedRender: PuckComponent<ProductSliderProps> = (props) => (
  <ProductSliderBody props={props as unknown as ProductSliderProps} tier={useViewportBreakpointTier()} editing={false} />
);

const PRODUCT_SLIDER_FIELDS = {
  source: {
    type: 'select' as const,
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
  searchQuery: { type: 'text' as const, label: 'Search query', metadata: CATALOG_DATA_FIELD_META },
  limit: { type: 'number' as const, label: 'Limit', min: 1, max: 24, metadata: CATALOG_DATA_FIELD_META },
  ...CAROUSEL_HEADER_FIELDS,
  // R21G (T338): the header lead's size, weight and colour.
  ...LISTING_LEAD_FIELDS,
  ...PRODUCT_LISTING_CARD_FIELDS,
  ...CAROUSEL_TRACK_FIELDS,
  ...PRODUCT_LISTING_FOOTER_FIELDS,
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const productSliderConfig: ComponentConfig<ProductSliderProps> = {
  label: 'Product slider',
  fields: PRODUCT_SLIDER_FIELDS as unknown as Fields<ProductSliderProps>,
  defaultProps: {
    source: 'manual',
    productSlugs: [],
    categorySlug: '',
    searchQuery: '',
    limit: 12,
    headingLevel: 'h2',
    headingSize: 'h3',
    cardVariant: 'default',
    ctaLabel: '',
    // Today's look: 1 / 4 / 8 per view, a 16 px gap, arrows over the edges and dots below.
    slidesPerView: DEFAULT_SLIDES_PER_VIEW,
    gap: 'custom',
    gapPx: 16,
    effect: 'slide',
    controls: { arrows: true, dots: true },
    controlsPlacement: 'overlay',
    bleed: 'none',
    autoplay: false,
    intervalMs: 5000,
    equalHeight: true,
    ...DEFAULT_BOX_PROPS,
  },
  // A slider stored before is carried into the new shape when it is opened.
  // T129: a placement stored inside `controls` moves to `controlsPlacement` once opened.
  resolveData: ({ props }) => ({
    props: carouselPlacementMoved(productSliderFromLegacy(props as unknown as Record<string, unknown>)) as unknown as ProductSliderProps,
  }),
  // Filters the host's field set, so the admin's pickers survive; the Custom px show once Custom is chosen.
  resolveFields: (data, { fields }) => {
    const props = productSliderFromLegacy(data.props as unknown as Record<string, unknown>) as ProductSliderProps;
    const resolved = resolveProductSourceFields(fields as never, props.source ?? 'manual') as Record<string, unknown>;
    if (!usesCustom(props.gap)) delete resolved['gapPx'];
    if (!usesCustom(props.headingSize)) delete resolved['headingSizePx'];
    // R23 (T435): the heading's line height with a Custom px size only.
    if (!usesCustom(props.headingSize)) delete resolved['headingLineHeight'];
    if (!usesCustom(props.headingMaxWidth)) delete resolved['headingMaxWidthPx'];
    if (!usesCustom(props.leadSize)) delete resolved['leadSizePx'];
    if (props.effect === 'fade') delete resolved['slidesPerView'];
    withoutUnusedCardFields(resolved, props);
    // R17 (T213): the interval, the arrows' look and the controls' placement only where they apply.
    withoutUnusedCarouselFields(props, resolved);
    return resolved as typeof fields;
  },
  render: (props) =>
    props.puck?.isEditing ? <ProductSliderEditingRender {...props} /> : <ProductSliderPublishedRender {...props} />,
};

export const ProductSlider = withHideOn(productSliderConfig);
