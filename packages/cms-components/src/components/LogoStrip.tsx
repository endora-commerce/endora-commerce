'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import { PB_DATA_METADATA, withHideOn } from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { LogoStripItem, LogoStripProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';

function normalizeLogoItem(item: LogoStripItem): LogoStripItem {
  const image = item.image;
  if (!image) return item;
  return {
    ...item,
    imageSource: image.imageSource ?? item.imageSource ?? 'url',
    src: image.src ?? item.src ?? '',
    assetId: image.assetId ?? item.assetId ?? '',
  };
}

function syncLogoItemImage(item: LogoStripItem): LogoStripItem {
  const imageSource = item.image?.imageSource ?? item.imageSource ?? 'url';
  const src = item.image?.src ?? item.src ?? '';
  const assetId = item.image?.assetId ?? item.assetId ?? '';
  return {
    ...item,
    image: { imageSource, src, assetId },
    imageSource,
    src,
    assetId,
  };
}

function LogoStripBody({
  props,
  editing,
  tier,
}: {
  props: LogoStripProps;
  editing: boolean;
  tier: 'mobile' | 'tablet' | 'desktop' | null;
}): React.ReactElement {
  const {
    items = [],
    gap = 32,
    logoMaxHeightPx = 48,
    grayscale = true,
    align = 'center',
    ...box
  } = props;
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();

  return (
    <BoxStyled {...box} {...(editing && tier ? { previewTier: tier } : {})}>
      <ul
        className={`cmsc-pb-logo-strip${grayscale ? ' cmsc-pb-logo-strip--grayscale' : ''}`}
        style={{
          gap: `${gap}px`,
          justifyContent:
            align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        }}
      >
        {items.map((raw, index) => {
          const item = normalizeLogoItem(raw);
          const src = resolveImageUrl(
            {
              imageSource: item.imageSource ?? (item.assetId ? 'library' : 'url'),
              ...(item.src ? { src: item.src } : {}),
              ...(item.assetId ? { assetId: item.assetId } : {}),
            },
            null,
            assets,
            mediaBaseUrl,
          );
          if (!src && !editing) return null;
          const img = (
            <img
              src={src || undefined}
              alt={item.alt || 'Logo'}
              style={{ maxHeight: `${logoMaxHeightPx}px` }}
              className="cmsc-pb-logo-strip__img"
            />
          );
          return (
            <li key={`${item.alt ?? 'logo'}-${index}`}>
              {item.href ? (
                <a href={item.href} target="_blank" rel="noopener noreferrer">
                  {src ? img : editing ? (
                    <span className="cmsc:text-xs cmsc:text-[#94a3b8]">Logo</span>
                  ) : null}
                </a>
              ) : src ? (
                img
              ) : editing ? (
                <span className="cmsc:text-xs cmsc:text-[#94a3b8]">Logo</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </BoxStyled>
  );
}

const LogoStripEditingRender: PuckComponent<LogoStripProps> = (props) => (
  <LogoStripBody props={props} editing tier={usePreviewBreakpointTier()} />
);

const LogoStripPublishedRender: PuckComponent<LogoStripProps> = (props) => (
  <LogoStripBody props={props} editing={false} tier={null} />
);

const logoStripConfig: ComponentConfig<LogoStripProps> = {
  label: 'Logo strip',
  fields: {
    items: {
      type: 'array',
      label: 'Logos',
      getItemSummary: (item, index) => item.alt?.trim() || `Logo ${(index ?? 0) + 1}`,
      arrayFields: {
        imageSource: {
          type: 'select',
          label: 'Image source',
          metadata: PB_DATA_METADATA,
          options: [
            { label: 'URL', value: 'url' },
            { label: 'Asset library', value: 'library' },
          ],
        },
        src: { type: 'text', label: 'Image URL', metadata: PB_DATA_METADATA },
        assetId: { type: 'text', label: 'Image', metadata: PB_DATA_METADATA },
        alt: { type: 'text', label: 'Alt text' },
        href: { type: 'text', label: 'Link URL (optional)' },
      },
      defaultItemProps: {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: '',
        href: '',
      },
    },
    gap: { type: 'number', label: 'Gap (px)', min: 8, max: 80 },
    logoMaxHeightPx: { type: 'number', label: 'Logo max height (px)', min: 16, max: 120 },
    grayscale: {
      type: 'radio',
      label: 'Grayscale',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    align: {
      type: 'select',
      label: 'Align',
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
    items: [
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 1',
        href: '',
      },
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 2',
        href: '',
      },
      {
        imageSource: 'url',
        src: '',
        assetId: '',
        image: { imageSource: 'url', src: '', assetId: '' },
        alt: 'Partner 3',
        href: '',
      },
    ],
    gap: 32,
    logoMaxHeightPx: 48,
    grayscale: true,
    align: 'center',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }, { changed }) => {
    if (!changed.items) return { props };
    return {
      props: {
        ...props,
        items: (props.items ?? []).map(syncLogoItemImage),
      },
    };
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <LogoStripEditingRender {...props} />
    ) : (
      <LogoStripPublishedRender {...props} />
    ),
};

export const LogoStrip = withHideOn(logoStripConfig);
