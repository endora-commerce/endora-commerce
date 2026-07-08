'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import type { CSSProperties, ReactNode } from 'react';
import {
  buildResponsiveNumberVars,
  CORNER_RADIUS_PX,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  resolveResponsiveNumber,
  resolveTextAlignClassForTier,
  responsiveTextAlignClass,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ImageProps, ImageWidthMode } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  CORNER_RADIUS_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';

function imageDimensions(
  widthMode: ImageProps['widthMode'],
  widthPx: ImageProps['widthPx'],
  tier: 'mobile' | 'tablet' | 'desktop',
): CSSProperties {
  const mode = resolveResponsive(widthMode, tier, 'auto' as ImageWidthMode);
  if (mode === 'full') return { width: '100%', maxWidth: '100%', height: 'auto' };
  if (mode === 'custom') {
    const px = resolveResponsiveNumber(widthPx, tier, 320);
    return { width: `${px}px`, maxWidth: '100%', height: 'auto' };
  }
  return { width: 'auto', maxWidth: '100%', height: 'auto' };
}

function imageStyle(
  props: Pick<ImageProps, 'objectFit' | 'opacity' | 'widthMode' | 'widthPx'> & {
    cornerRadius?: ImageProps['cornerRadius'];
  },
  tier: 'mobile' | 'tablet' | 'desktop' | null,
): CSSProperties {
  return {
    ...imageDimensions(props.widthMode, props.widthPx, tier ?? 'mobile'),
    objectFit: props.objectFit ?? 'cover',
    opacity: (props.opacity ?? 100) / 100,
    ...(props.cornerRadius ? { borderRadius: `${CORNER_RADIUS_PX[props.cornerRadius]}px` } : {}),
    display: 'inline-block',
    verticalAlign: 'middle',
  };
}

function ImageContent({
  props,
  tier,
  editing,
}: {
  props: Pick<
    ImageProps,
    'src' | 'alt' | 'href' | 'linkTarget' | 'objectFit' | 'opacity' | 'widthMode' | 'widthPx'
  > & { cornerRadius?: ImageProps['cornerRadius'] };
  tier: 'mobile' | 'tablet' | 'desktop' | null;
  editing: boolean;
}): ReactNode {
  if (!props.src) {
    return editing ? (
      <div className="cmsc:flex cmsc:min-h-[120px] cmsc:items-center cmsc:justify-center cmsc:rounded-[8px] cmsc:border cmsc:border-dashed cmsc:border-[#d9e0e7] cmsc:text-[#64748b] cmsc:text-sm">
        Add an image URL
      </div>
    ) : null;
  }

  const img = (
    <img
      src={props.src}
      alt={props.alt ?? ''}
      className={tier ? undefined : 'cmsc-pb-image-width'}
      style={imageStyle(props, tier)}
    />
  );

  if (props.href) {
    return (
      <a
        href={props.href}
        target={props.linkTarget ?? '_self'}
        rel={props.linkTarget === '_blank' ? 'noreferrer' : undefined}
        className="cmsc:inline-block"
      >
        {img}
      </a>
    );
  }

  return img;
}

const ImageEditingRender: PuckComponent<ImageProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const {
    align,
    src,
    alt,
    href,
    linkTarget,
    objectFit,
    opacity,
    cornerRadius,
    widthMode,
    widthPx,
    ...box
  } = props;

  return (
    <BoxStyled previewTier={tier} {...box}>
      <div className={resolveTextAlignClassForTier(align, tier, 'left')}>
        <ImageContent
          props={{ src, alt, href, linkTarget, objectFit, opacity, cornerRadius, widthMode, widthPx }}
          tier={tier}
          editing
        />
      </div>
    </BoxStyled>
  );
};

const ImagePublishedRender: PuckComponent<ImageProps> = (props) => {
  const {
    align,
    src,
    alt,
    href,
    linkTarget,
    objectFit,
    opacity,
    cornerRadius,
    widthMode,
    widthPx,
    ...box
  } = props;
  const usesCustomWidth =
    resolveResponsive(widthMode, 'mobile', 'auto') === 'custom' ||
    resolveResponsive(widthMode, 'tablet', 'auto') === 'custom' ||
    resolveResponsive(widthMode, 'desktop', 'auto') === 'custom';

  return (
    <BoxStyled
      {...box}
      {...(usesCustomWidth ? { style: buildResponsiveNumberVars('image-width', widthPx, 320) } : {})}
    >
      <div className={responsiveTextAlignClass(align, 'left')}>
        <ImageContent
          props={{ src, alt, href, linkTarget, objectFit, opacity, cornerRadius, widthMode, widthPx }}
          tier={null}
          editing={false}
        />
      </div>
    </BoxStyled>
  );
};

const WIDTH_MODE_OPTIONS = [
  { label: 'Auto', value: 'auto' },
  { label: 'Full width', value: 'full' },
  { label: 'Custom (px)', value: 'custom' },
];

const imageConfig: ComponentConfig<{ props: ImageProps }> = {
  label: 'Image',
  fields: {
    src: { type: 'text', label: 'Image URL' },
    alt: { type: 'text', label: 'Alt text' },
    href: { type: 'text', label: 'Link URL' },
    linkTarget: {
      type: 'select',
      label: 'Link target',
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
      ],
    },
    objectFit: {
      type: 'select',
      label: 'Object fit',
      options: [
        { label: 'Cover', value: 'cover' },
        { label: 'Contain', value: 'contain' },
        { label: 'Fill', value: 'fill' },
        { label: 'None', value: 'none' },
      ],
    },
    opacity: {
      type: 'number',
      label: 'Opacity (%)',
      min: 0,
      max: 100,
      step: 5,
    },
    cornerRadius: CORNER_RADIUS_FIELD,
    widthMode: {
      type: 'select',
      label: 'Width',
      metadata: PB_RESPONSIVE_METADATA,
      options: WIDTH_MODE_OPTIONS,
    },
    widthPx: {
      type: 'number',
      label: 'Custom width (px)',
      min: 16,
      max: 2000,
      step: 8,
      metadata: PB_RESPONSIVE_METADATA,
    },
    align: {
      type: 'select',
      label: 'Align',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    ...DEFAULT_BOX_PROPS,
    src: '',
    alt: '',
    href: '',
    linkTarget: '_self',
    objectFit: 'cover',
    opacity: 100,
    widthMode: 'auto',
    widthPx: 320,
    align: 'left',
  },
  render: (props) =>
    props.puck?.isEditing ? <ImageEditingRender {...props} /> : <ImagePublishedRender {...props} />,
};

export const Image = withHideOn(imageConfig);
