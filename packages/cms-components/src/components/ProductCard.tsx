'use client';

import { type ComponentConfig, type Field, type PuckComponent } from '@measured/puck';
import { PB_RESPONSIVE_METADATA, withHideOn } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { CmsProductCardProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import { createCatalogSlugFallbackField } from '../fields/catalog-fallback-fields.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CmsProductCardLoader } from './CmsProductCard.js';

function ProductCardShell({
  margin,
  padding,
  border,
  cardProps,
  tier,
  editing,
}: {
  margin: CmsProductCardProps['margin'];
  padding: CmsProductCardProps['padding'];
  border: CmsProductCardProps['border'];
  cardProps: Omit<CmsProductCardProps, 'margin' | 'padding' | 'border'>;
  tier: ReturnType<typeof usePreviewBreakpointTier>;
  editing: boolean;
}): React.ReactElement {
  return (
    <BoxStyled
      {...(margin !== undefined ? { margin } : {})}
      {...(padding !== undefined ? { padding } : {})}
      {...(border !== undefined ? { border } : {})}
      {...(editing ? { previewTier: tier } : {})}
    >
      <CmsProductCardLoader editing={editing} previewTier={tier} {...cardProps} />
    </BoxStyled>
  );
}

const ProductCardEditingRender: PuckComponent<CmsProductCardProps> = (props) => {
  const { puck: _puck, margin, padding, border, ...cardProps } = props;
  return (
    <ProductCardShell
      margin={margin}
      padding={padding}
      border={border}
      cardProps={cardProps}
      tier={usePreviewBreakpointTier()}
      editing
    />
  );
};

const ProductCardPublishedRender: PuckComponent<CmsProductCardProps> = (props) => {
  const { puck: _puck, margin, padding, border, ...cardProps } = props;
  return (
    <ProductCardShell
      margin={margin}
      padding={padding}
      border={border}
      cardProps={cardProps}
      tier={useViewportBreakpointTier()}
      editing={false}
    />
  );
};

const productCardConfig: ComponentConfig<CmsProductCardProps> = {
  label: 'Product card',
  fields: {
    productSlug: createCatalogSlugFallbackField('Product') as Field<string>,
    showPrice: { type: 'radio', label: 'Show price', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    showSku: { type: 'radio', label: 'Show SKU', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    showStock: { type: 'radio', label: 'Show stock', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    imageRatio: {
      type: 'select',
      label: 'Image ratio',
      options: [
        { label: 'Square', value: 'square' },
        { label: '4:3', value: '4:3' },
        { label: '16:9', value: '16:9' },
        { label: 'Auto', value: 'auto' },
      ],
    },
    imageHeightPx: {
      type: 'number',
      label: 'Image height (px, optional)',
      min: 0,
      max: 800,
      step: 8,
      metadata: PB_RESPONSIVE_METADATA,
    },
    imageObjectFit: {
      type: 'select',
      label: 'Image object fit',
      options: [
        { label: 'Contain', value: 'contain' },
        { label: 'Cover', value: 'cover' },
        { label: 'Fill', value: 'fill' },
        { label: 'None', value: 'none' },
      ],
    },
    maxWidthPx: {
      type: 'number',
      label: 'Max width (px, 0 = full)',
      min: 0,
      max: 1200,
      step: 8,
      metadata: PB_RESPONSIVE_METADATA,
    },
    cornerRadius: CORNER_RADIUS_FIELD,
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
    imageObjectFit: 'contain',
    maxWidthPx: 0,
    imageHeightPx: 0,
    variant: 'default',
    ctaLabel: '',
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <ProductCardEditingRender {...props} />
    ) : (
      <ProductCardPublishedRender {...props} />
    ),
};

export const ProductCard = withHideOn(productCardConfig);
