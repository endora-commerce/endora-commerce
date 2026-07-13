'use client';

import { useEffect, useState } from 'react';
import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@b2b/page-builder-core';
import type { CategoryListProps } from '../schema/component-types.js';
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
  const [items, setItems] = useState<{ slug: string; name: string; productCount: number; depth: number }[]>([]);

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

  const listClass = `cmsc-pb-category-list cmsc-pb-category-list--${layout}`;

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' } : {})}>
      {items.length === 0 ? (
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
    categorySlugs: { type: 'text', label: 'Category slugs (comma-separated)', metadata: CATALOG_DATA_FIELD_META },
    parentSlug: { type: 'text', label: 'Parent category slug', metadata: CATALOG_DATA_FIELD_META },
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
