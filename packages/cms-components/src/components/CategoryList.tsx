'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import { createToggleField, withHideOn } from '@endora-commerce/page-builder-core';
import type { CategoryListProps } from '../schema/component-types.js';
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
import { estimateCategoryListSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { CategoryListSkeleton } from './catalog/CatalogSkeletons.js';
import { resolveCategorySelectionFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';

const CategoryListRender: PuckComponent<CategoryListProps> = (props) => {
  // Feature 167 — internal links take the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  const {
    selectionMode = 'all',
    categorySlugs = [],
    parentSlug = '',
    layout = 'list',
    showCounts = true,
    maxDepth,
    puck,
    ...box
  } = props;
  const editing = puck?.isEditing === true;
  // Provided by the page's server render on the storefront; fetched from an effect only in
  // the editor preview, which is the one caller that ever sees `loading`.
  const { loading: isLoading, data } = useBlockData<CatalogCategoryItem[]>(
    categorySelectionDataRequest({ selectionMode, categorySlugs, parentSlug, maxDepth }),
    { holdSkeleton: true },
  );
  const items = data ?? [];

  const listClass = `cmsc-pb-category-list cmsc-pb-category-list--${layout}`;

  // Feature 169 (FR-003): shoppers see nothing of an empty listing; the editor explains why it is empty.
  if (!isLoading && items.length === 0 && !editing) return <></>;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' } : {})}>
      {isLoading ? (
        <CategoryListSkeleton count={estimateCategoryListSkeletonCount(selectionMode, categorySlugs)} />
      ) : items.length === 0 ? (
        <p className="cmsc-pb-product-grid__empty">
          No categories to preview — configure the selection in the sidebar.
        </p>
      ) : (
        <ul className={listClass}>
          {items.map((cat) => (
            <li key={cat.slug} style={{ paddingLeft: layout === 'list' ? `${cat.depth * 12}px` : undefined }}>
              <a href={localizePath(`/c/${cat.slug}`)} className="cmsc-pb-category-list__link">
                {cat.name}
                {showCounts ? <span className="cmsc-pb-category-list__count">({cat.productCount})</span> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </BoxStyled>
  );
};

const categoryListConfig: ComponentConfig<CategoryListProps> = {
  label: 'Category list',
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
    layout: {
      type: 'select',
      label: 'Layout',
      options: [
        { label: 'List', value: 'list' },
        { label: 'Inline', value: 'inline' },
        { label: 'Chips', value: 'chips' },
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
    layout: 'list',
    showCounts: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: CategoryListRender,
  resolveFields: (data, { fields }) =>
    resolveCategorySelectionFields(fields, data.props.selectionMode ?? 'all'),
};

export const CategoryList = withHideOn(categoryListConfig);
