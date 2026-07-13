'use client';

import { useEffect, useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import type { BreakpointTier } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { CategoryGridProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { fetchCategoryTree, filterCategories } from '../utils/catalog-fetch.js';
import { resolveCategorySelectionFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';

function CategoryGridBody({
  props,
  tier,
  editing,
}: {
  props: CategoryGridProps & { puck?: { isEditing?: boolean } };
  tier: BreakpointTier;
  editing: boolean;
}): React.ReactElement {
  const {
    selectionMode = 'all',
    categorySlugs = [],
    parentSlug = '',
    columns = 4,
    gap = 16,
    showImage = true,
    cardStyle = 'stacked',
    showCounts = true,
    maxDepth,
    puck: _puck,
    ...box
  } = props;
  const [items, setItems] = useState<{ slug: string; name: string; productCount: number; depth: number }[]>([]);
  const colCount = resolveResponsiveNumber(columns, tier, 4);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tree = await fetchCategoryTree();
        const filtered = filterCategories(tree, {
          selectionMode,
          categorySlugs,
          parentSlug,
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        });
        if (!cancelled) setItems(filtered);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectionMode, categorySlugs, parentSlug, maxDepth]);

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      {items.length === 0 ? (
        <p className="cmsc-pb-product-grid__empty">
          {editing ? 'No categories to preview — configure the selection in the sidebar.' : 'No categories found'}
        </p>
      ) : (
        <ul
          className={`cmsc-pb-category-grid cmsc-pb-category-grid--${cardStyle}`}
          style={{ gap: `${gapPx}px`, gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
          {items.map((cat) => (
            <li key={cat.slug}>
              <a href={`/c/${cat.slug}`} className="cmsc-pb-category-grid__card">
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
    categorySlugs: { type: 'text', label: 'Category slugs (comma-separated)', metadata: CATALOG_DATA_FIELD_META },
    parentSlug: { type: 'text', label: 'Parent category slug', metadata: CATALOG_DATA_FIELD_META },
    columns: { type: 'number', label: 'Columns', min: 2, max: 6, metadata: PB_RESPONSIVE_METADATA },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48, metadata: PB_RESPONSIVE_METADATA },
    showImage: { type: 'radio', label: 'Show image placeholder', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    cardStyle: {
      type: 'select',
      label: 'Card style',
      options: [
        { label: 'Stacked', value: 'stacked' },
        { label: 'Overlay', value: 'overlay' },
        { label: 'Minimal', value: 'minimal' },
      ],
    },
    showCounts: { type: 'radio', label: 'Show counts', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
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
    gap: 16,
    showImage: true,
    cardStyle: 'stacked',
    showCounts: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <CategoryGridEditingRender {...props} /> : <CategoryGridPublishedRender {...props} />,
  resolveFields: (data, { fields }) =>
    resolveCategorySelectionFields(fields, data.props.selectionMode ?? 'all'),
};

export const CategoryGrid = withHideOn(categoryGridConfig);
