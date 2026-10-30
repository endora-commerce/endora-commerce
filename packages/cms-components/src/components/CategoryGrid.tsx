'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import {
  createToggleField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import type { BreakpointTier, ResponsiveProp } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { CategoryGridProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import { useCmsRenderLocalizePath } from './render-context.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { useBlockData } from '../hooks/use-block-data.js';
import { categorySelectionDataRequest, type CatalogCategoryItem } from '../utils/block-data.js';
import { estimateCategoryGridSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { CategoryGridSkeleton } from './catalog/CatalogSkeletons.js';
import { resolveCategorySelectionFields } from '../fields/catalog-resolve-fields.js';
import { GAP_OPTIONS, gapPxField } from '../fields/section-block-fields.js';
import { gapCss, numericGapAsCustom, usesCustom } from './section-parts.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';

function CategoryGridBody({
  props,
  tier,
  editing,
}: {
  props: CategoryGridProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement | null {
  // Feature 167 — internal links take the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  const {
    selectionMode = 'all',
    categorySlugs = [],
    parentSlug = '',
    columns = 4,
    gap = 16,
    gapPx: storedGapPx,
    showImage = true,
    cardStyle = 'stacked',
    showCounts = true,
    maxDepth,
    equalItemHeight = true,
    puck: _puck,
    ...box
  } = props;
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading: isLoading, data } = useBlockData<CatalogCategoryItem[]>(
    categorySelectionDataRequest({ selectionMode, categorySlugs, parentSlug, maxDepth }),
    { holdSkeleton: true },
  );
  const items = data ?? [];
  const colCount = resolveResponsiveNumber(columns, tier, 4);
  // R17 (T207): a size or a Custom px per breakpoint; a stored number is today's px gap.
  const gapLength = gapCss(gap as never, storedGapPx, 16, tier);
  const gapPx = Number(/(\d+(?:\.\d+)?)px\)?$/.exec(gapLength)?.[1] ?? 16);
  // R17 (T219): equal heights per breakpoint; a stored boolean is every breakpoint's.
  const equalHeights = resolveResponsive<boolean>(equalItemHeight as boolean | ResponsiveProp<boolean>, tier, true);

  // Feature 169 (FR-003): shoppers see nothing of an empty listing; the editor explains why it is empty.
  if (!isLoading && items.length === 0 && !editing) return null;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      {isLoading ? (
        <CategoryGridSkeleton
          count={estimateCategoryGridSkeletonCount(selectionMode, categorySlugs, colCount)}
          columns={colCount}
          gap={gapPx}
        />
      ) : items.length === 0 ? (
        <p className="cmsc-pb-product-grid__empty">
          No categories to preview — configure the selection in the sidebar.
        </p>
      ) : (
        <ul
          className={[
            `cmsc-pb-category-grid cmsc-pb-category-grid--${cardStyle}`,
            equalHeights ? 'cmsc-pb-category-grid--equal-height' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ gap: gapLength, gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
          {items.map((cat) => (
            <li key={cat.slug}>
              <a href={localizePath(`/c/${cat.slug}`)} className="cmsc-pb-category-grid__card">
                {showImage ? <span className="cmsc-pb-category-grid__image" aria-hidden /> : null}
                <span className="cmsc-pb-category-grid__name">{cat.name}</span>
                {showCounts ? <span className="cmsc-pb-category-grid__count">{cat.productCount}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </BoxStyled>
  );
}

const CategoryGridEditingRender: PuckComponent<CategoryGridProps> = (props) => (
  <CategoryGridBody props={props} tier={usePreviewBreakpointTier()} editing />
);

const CategoryGridPublishedRender: PuckComponent<CategoryGridProps> = (props) => (
  <CategoryGridBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const categoryGridConfig: ComponentConfig<CategoryGridProps> = {
  label: 'Category grid',
  fields: {
    selectionMode: {
      type: 'select',
      label: 'Selection',
      metadata: CATALOG_DATA_FIELD_META,
      options: [
        { label: 'All categories', value: 'all' },
        { label: 'Manual', value: 'manual' },
        { label: 'Children of parent', value: 'childrenOf' },
      ],
    },
    categorySlugs: createCatalogSlugsFallbackField('Categories'),
    parentSlug: createCatalogSlugFallbackField('Parent category'),
    columns: { type: 'number', label: 'Columns', min: 2, max: 6, metadata: PB_RESPONSIVE_METADATA },
    // R17 (T219): with the columns, per breakpoint.
    equalItemHeight: createToggleField({ label: 'Equal items height', defaultValue: true, metadata: PB_RESPONSIVE_METADATA }) as never,
    // R17 (T207): the gap as every other block's — a size or a Custom px, per breakpoint.
    gap: { type: 'select', label: 'Gap', metadata: PB_RESPONSIVE_METADATA, options: GAP_OPTIONS },
    gapPx: { ...gapPxField('Custom gap (px)'), max: 48 },
    showImage: createToggleField({ label: 'Show image placeholder', defaultValue: true }),
    cardStyle: {
      type: 'select',
      label: 'Card style',
      options: [
        { label: 'Stacked', value: 'stacked' },
        { label: 'Overlay', value: 'overlay' },
        { label: 'Minimal', value: 'minimal' },
      ],
    },
    showCounts: createToggleField({ label: 'Show counts', defaultValue: true }),
    maxDepth: { type: 'number', label: 'Max depth (optional)', min: 0, max: 5, metadata: CATALOG_DATA_FIELD_META },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    selectionMode: 'all',
    categorySlugs: [],
    parentSlug: '',
    columns: 4,
    gap: 'custom',
    gapPx: 16,
    showImage: true,
    cardStyle: 'stacked',
    showCounts: true,
    equalItemHeight: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <CategoryGridEditingRender {...props} /> : <CategoryGridPublishedRender {...props} />,
  // R17 (T207): a gap stored as a number reads as Custom with that px (the render is the same).
  resolveData: ({ props }) => {
    const carried = numericGapAsCustom(props.gap, props.gapPx);
    return { props: (carried ? { ...props, ...carried } : props) as never };
  },
  resolveFields: (data, { fields }) => {
    const resolved = { ...resolveCategorySelectionFields(fields, data.props.selectionMode ?? 'all') } as Record<string, unknown>;
    if (!usesCustom(numericGapAsCustom(data.props.gap, data.props.gapPx)?.gap ?? data.props.gap)) delete resolved['gapPx'];
    return resolved as typeof fields;
  },
};

export const CategoryGrid = withHideOn(categoryGridConfig);
