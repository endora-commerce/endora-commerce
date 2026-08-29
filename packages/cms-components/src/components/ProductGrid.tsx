'use client';

import { useEffect, useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CmsProductSummary } from '../schema/catalog-types.js';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import type { BreakpointTier } from '@endora-commerce/page-builder-core';
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
import { fetchProductsBySlugs, fetchProductsList } from '../utils/catalog-fetch.js';
import { waitForCatalogSkeletonMin } from '../utils/catalog-load.js';
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
}): React.ReactElement {
  const {
    source = 'manual',
    productSlugs = [],
    categorySlug = '',
    searchQuery = '',
    limit = 12,
    columns = 4,
    gap = 16,
    view = 'grid',
    equalItemHeight = true,
    puck: _puck,
    ...box
  } = props;
  const [products, setProducts] = useState<CmsProductSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const colCount = resolveResponsiveNumber(columns, tier, 4);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const gridView = resolveResponsive(view, tier, 'grid');

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
        <ProductGridSkeleton
          count={estimateProductGridSkeletonCount(source, productSlugs, limit, colCount)}
          columns={colCount}
          gap={gapPx}
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

  const listClass = [
    gridView === 'list' ? 'cmsc-pb-product-grid cmsc-pb-product-grid--list' : 'cmsc-pb-product-grid',
    equalItemHeight ? 'cmsc-pb-product-grid--equal-height' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <ul
        className={listClass}
        style={{
          gap: `${gapPx}px`,
          gridTemplateColumns: gridView === 'grid' ? `repeat(${colCount}, minmax(0, 1fr))` : undefined,
        }}
      >
        {products.map((p) => (
          <li key={p.id}>
            <CmsProductCardView product={p} variant={gridView === 'list' ? 'horizontal' : 'default'} />
          </li>
        ))}
      </ul>
    </BoxStyled>
  );
}

const ProductGridEditingRender: PuckComponent<ProductGridProps> = (props) => (
  <ProductGridBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const ProductGridPublishedRender: PuckComponent<ProductGridProps> = (props) => (
  <ProductGridBody props={props} tier={useViewportBreakpointTier()} editing={false} />
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
    equalItemHeight: {
      type: 'radio',
      label: 'Equal items height',
      options: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    },
    columns: { type: 'number', label: 'Columns', min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48, metadata: PB_RESPONSIVE_METADATA },
    view: {
      type: 'select',
      label: 'View',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Grid', value: 'grid' },
        { label: 'List', value: 'list' },
      ],
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
    columns: 4,
    gap: 16,
    view: 'grid',
    equalItemHeight: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ProductGridEditingRender {...props} /> : <ProductGridPublishedRender {...props} />,
  resolveFields: (data, { fields }) => resolveProductSourceFields(fields, data.props.source ?? 'manual'),
};

export const ProductGrid = withHideOn(productGridConfig);
