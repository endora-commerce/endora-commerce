'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { withHideOn } from '@b2b/page-builder-core';
import type { CmsProductCardProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { CATALOG_DATA_FIELD_META } from '../fields/catalog-data-fields.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CmsProductCardLoader } from './CmsProductCard.js';

const ProductCardRender: PuckComponent<CmsProductCardProps> = (props) => {
  const { puck, ...rest } = props;
  const editing = puck?.isEditing === true;
  const { margin, padding, border, ...cardProps } = rest;
  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(editing ? { previewTier: 'desktop' as const } : {})}
    >
      <CmsProductCardLoader editing={editing} {...cardProps} />
    </BoxStyled>
  );
};

const productCardConfig: ComponentConfig<CmsProductCardProps> = {
  label: 'Product card',
  fields: {
    productSlug: { type: 'text', label: 'Product slug', metadata: CATALOG_DATA_FIELD_META },
    showPrice: { type: 'radio', label: 'Show price', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    showSku: { type: 'radio', label: 'Show SKU', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    showStock: { type: 'radio', label: 'Show stock', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    imageRatio: {
      type: 'select',
      label: 'Image ratio',
      options: [
        { label: 'Square', value: 'square' },
        { label: '4:3', value: '4:3' },
      ],
    },
    variant: {
      type: 'select',
      label: 'Variant',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Compact', value: 'compact' },
        { label: 'Horizontal', value: 'horizontal' },
      ],
    },
    ctaLabel: { type: 'text', label: 'CTA label (optional)' },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    productSlug: '',
    showPrice: true,
    showSku: true,
    showStock: true,
    imageRatio: 'square',
    variant: 'default',
    ctaLabel: '',
    ...DEFAULT_BOX_PROPS,
  },
  render: ProductCardRender,
};

export const ProductCard = withHideOn(productCardConfig);
