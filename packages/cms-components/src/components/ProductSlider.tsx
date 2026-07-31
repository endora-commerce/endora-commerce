'use client';

import { useEffect, useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { useEditorCarouselPage } from '@b2b/page-builder-core/editor/carousel-preview';
import type { BreakpointTier } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
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
import { ProductSliderSkeleton } from './catalog/CatalogSkeletons.js';
import { fetchProductsBySlugs, fetchProductsList } from '../utils/catalog-fetch.js';
import { waitForCatalogSkeletonMin } from '../utils/catalog-load.js';
import { estimateProductSliderSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { resolveProductSourceFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';

function ProductSliderBody({
  props,
  tier,
  editing,
  previewPage = 0,
}: {
  props: ProductSliderProps & { id?: string; puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
  previewPage?: number;
}): React.ReactElement {
  const {
    source = 'manual',
    productSlugs = [],
    categorySlug = '',
    searchQuery = '',
    limit = 12,
    slidesPerView = { base: 1, tablet: 4, desktop: 8 },
    gap = 16,
    autoplay = false,
    intervalMs = 5000,
    showArrows = true,
    showDots = true,
    equalHeight = true,
    puck: _puck,
    ...box
  } = props;
  const [products, setProducts] = useState<CmsProductSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const perViewFallback = tier === 'desktop' ? 8 : tier === 'tablet' ? 4 : 1;
  const perView = resolveResponsiveNumber(slidesPerView, tier, perViewFallback);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const carouselId = typeof props.id === 'string' ? props.id : undefined;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const startedAt = Date.now();
    void (async () => {
      try {
        let list: CmsProductSummary[] = [];
        if (source === 'manual') list = await fetchProductsBySlugs(productSlugs);
        else
          list = await fetchProductsList({
            ...(source === 'category' && categorySlug ? { categorySlug } : {}),
            ...(source === 'query' && searchQuery ? { q: searchQuery } : {}),
            limit,
          });
        await waitForCatalogSkeletonMin(startedAt);
        if (!cancelled) setProducts(list);
      } catch {
        await waitForCatalogSkeletonMin(startedAt);
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, productSlugs, categorySlug, searchQuery, limit]);

  if (isLoading) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <ProductSliderSkeleton
          count={estimateProductSliderSkeletonCount(source, productSlugs, limit, perView)}
          slidesPerView={slidesPerView}
          gap={gap}
        />
      </BoxStyled>
    );
  }

  if (products.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <p className="cmsc-pb-product-grid__empty">
          {editing
            ? source === 'category' && !categorySlug
              ? 'Select a category in the sidebar to preview products.'
              : source === 'category'
                ? 'No products in this category (or none visible for preview).'
                : source === 'query' && !searchQuery
                  ? 'Enter a search query in the sidebar to preview products.'
                  : 'No products to preview — configure the source in the sidebar.'
            : 'No products found'}
        </p>
      </BoxStyled>
    );
  }

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        equalHeight={equalHeight}
        editorPreview={editing}
        previewPage={editing ? previewPage : 0}
        {...(editing && carouselId !== undefined ? { editorCarouselId: carouselId } : {})}
      >
        {products.map((p) => (
          <CmsProductCardView key={p.id} product={p} />
        ))}
      </CarouselShell>
    </BoxStyled>
  );
}

const ProductSliderEditingRender: PuckComponent<ProductSliderProps> = (props) => {
  const carouselId = (props as ProductSliderProps & { id?: string }).id;
  const previewPage = useEditorCarouselPage(carouselId);
  return <ProductSliderBody props={props} tier={usePreviewBreakpointTier()} editing previewPage={previewPage} />;
};

const ProductSliderPublishedRender: PuckComponent<ProductSliderProps> = (props) => (
  <ProductSliderBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const productSliderConfig: ComponentConfig<ProductSliderProps> = {
  label: 'Product slider',
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
    slidesPerView: { type: 'number', label: 'Slides per view', min: 1, max: 8, metadata: PB_RESPONSIVE_METADATA },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48, metadata: PB_RESPONSIVE_METADATA },
    autoplay: { type: 'radio', label: 'Autoplay', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    intervalMs: { type: 'number', label: 'Interval (ms)', min: 2000, max: 15000 },
    showArrows: { type: 'radio', label: 'Arrows', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
    showDots: { type: 'radio', label: 'Dots', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
    equalHeight: {
      type: 'radio',
      label: 'Equal slide height',
      options: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    source: 'manual',
    productSlugs: [],
    categorySlug: '',
    searchQuery: '',
    limit: 12,
    slidesPerView: { base: 1, tablet: 4, desktop: 8 },
    gap: 16,
    autoplay: false,
    intervalMs: 5000,
    showArrows: true,
    showDots: true,
    equalHeight: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ProductSliderEditingRender {...props} /> : <ProductSliderPublishedRender {...props} />,
  resolveFields: (data, { fields }) => resolveProductSourceFields(fields, data.props.source ?? 'manual'),
};

export const ProductSlider = withHideOn(productSliderConfig);
