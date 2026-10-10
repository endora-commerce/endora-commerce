'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import { withHideOn } from '@endora-commerce/page-builder-core';
import type { CategoryListProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { useCatalogBlockData } from '../hooks/use-catalog-block-data.js';
import { categorySelectionDataRequest, type CatalogCategoryItem } from '../utils/catalog-block-data.js';
import { estimateCategoryListSkeletonCount } from '../utils/catalog-skeleton-estimate.js';
import { CategoryListSkeleton } from './catalog/CatalogSkeletons.js';
import { resolveCategorySelectionFields } from '../fields/catalog-resolve-fields.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  createCatalogSlugFallbackField,
  createCatalogSlugsFallbackField,
} from '../fields/catalog-fallback-fields.js';

const CategoryListRender: PuckComponent<CategoryListProps> = (props) => {
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
  const { loading: isLoading, data } = useCatalogBlockData<CatalogCategoryItem[]>(
    categorySelectionDataRequest({ selectionMode, categorySlugs, parentSlug, maxDepth }),
    { holdSkeleton: true },
  );
  const items = data ?? [];

  const listClass = `cmsc-pb-category-list cmsc-pb-category-list--${layout}`;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' } : {})}>
      {isLoading ? (
        <CategoryListSkeleton count={estimateCategoryListSkeletonCount(selectionMode, categorySlugs)} />
      ) : items.length === 0 ? (
        <p className="cmsc-pb-product-grid__empty">
          {editing ? 'No categories to preview — configure the selection in the sidebar.' : 'No categories found'}
        </p>
      ) : (
        <ul className={listClass}>
          {items.map((cat) => (
            <li key={cat.slug} style={{ paddingLeft: layout === 'list' ? `${cat.depth * 12}px` : undefined }}>
              <a href={`/c/${cat.slug}`} className="cmsc-pb-category-list__link">
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
    layout: 'list',
    showCounts: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: CategoryListRender,
  resolveFields: (data, { fields }) =>
    resolveCategorySelectionFields(fields, data.props.selectionMode ?? 'all'),
};

export const CategoryList = withHideOn(categoryListConfig);
