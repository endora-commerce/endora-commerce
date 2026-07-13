'use client';

import { useEffect, useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
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
import { fetchProductsBySlugs, fetchProductsList } from '../utils/catalog-fetch.js';
import { resolveProductSourceFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';

function ProductSliderBody({
  props,
  tier,
  editing,
}: {
  props: ProductSliderProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    source = 'manual',
    productSlugs = [],
    categorySlug = '',
    searchQuery = '',
    limit = 12,
    slidesPerView = 1,
    gap = 16,
    autoplay = false,
    intervalMs = 5000,
    showArrows = true,
    showDots = true,
    puck: _puck,
    ...box
  } = props;
  const [products, setProducts] = useState<CmsProductSummary[]>([]);
  const perView = resolveResponsiveNumber(slidesPerView, tier, 1);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled) setProducts(list);
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, productSlugs, categorySlug, searchQuery, limit]);

  if (products.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <p className="cmsc-pb-product-grid__empty">
          {editing ? 'No products to preview — configure the source in the sidebar.' : 'No products found'}
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
      >
        {products.map((p) => (
          <CmsProductCardView key={p.id} product={p} />
        ))}
      </CarouselShell>
    </BoxStyled>
  );
}

const ProductSliderEditingRender: PuckComponent<ProductSliderProps> = (props) => (
  <ProductSliderBody props={props} tier={usePreviewBreakpointTier()} editing />
);

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
    productSlugs: { type: 'text', label: 'Product slugs (comma-separated)', metadata: CATALOG_DATA_FIELD_META },
    categorySlug: { type: 'text', label: 'Category slug', metadata: CATALOG_DATA_FIELD_META },
    searchQuery: { type: 'text', label: 'Search query', metadata: CATALOG_DATA_FIELD_META },
    limit: { type: 'number', label: 'Limit', min: 1, max: 24, metadata: CATALOG_DATA_FIELD_META },
    slidesPerView: { type: 'number', label: 'Slides per view', min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48, metadata: PB_RESPONSIVE_METADATA },
    autoplay: { type: 'radio', label: 'Autoplay', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    intervalMs: { type: 'number', label: 'Interval (ms)', min: 2000, max: 15000 },
    showArrows: { type: 'radio', label: 'Arrows', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
    showDots: { type: 'radio', label: 'Dots', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
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
    slidesPerView: 1,
    gap: 16,
    autoplay: false,
    intervalMs: 5000,
    showArrows: true,
    showDots: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ProductSliderEditingRender {...props} /> : <ProductSliderPublishedRender {...props} />,
  resolveFields: (data, { fields }) => resolveProductSourceFields(fields, data.props.source ?? 'manual'),
};

export const ProductSlider = withHideOn(productSliderConfig);
