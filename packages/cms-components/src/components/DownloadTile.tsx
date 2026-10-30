'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import {
  CORNER_RADIUS_PX,
  createColorField,
  createToggleField,
  withHideOn,
  type BreakpointTier,
  type ResponsiveImage,
} from '@endora-commerce/page-builder-core';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { DownloadTileProps } from '../schema/component-types.js';
import { imageObjectField, sizePxField } from '../fields/section-block-fields.js';
import { CORNER_RADIUS_FIELD } from '../fields/shared-fields.js';
import { resolveLinkHref } from '../utils/link-href.js';
import { BUTTON_SPEC_OBJECT_FIELDS } from './Button.js';
import { colorValueToCss } from '../utils/color-value.js';
import { CMS_ICON_CATALOG, resolveCmsIcon } from './icon-catalog.js';
import { createIconPickerField } from './IconPickerField.js';
import { responsivePxVars } from './responsive-px.js';
import { absolutizeMediaUrl } from '../utils/resolve-image-url.js';
import { Picture } from './Picture.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl, type CmsRenderAsset, useCmsRenderLocalizePath } from './render-context.js';
import { hasImage } from './section-parts.js';
import { textWeightField } from './typography.js';
import { singleWeight, textStyleAttrs, type TextStyleValues } from './text-style.js';
import { spaceTokenField, spaceTokenVars } from './space-token.js';
import { sizeFieldWithDefault } from '../fields/section-block-fields.js';
import { ITEM_TAGS_FIELD, itemTagsAttribute } from './carousel/carousel-filter.js';

/**
 * `cms.DownloadTile` — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, US4, FR-020, FR-021: a file from the asset library,
 * referenced by identity (`fileAssetId`, which the page's asset map resolves),
 * so replacing the asset serves the new version without a page edit.
 *
 * The tile is one `<a href download>` named by its content — the title, the
 * subtitle and the link label ("Download" unless the editor writes another).
 * A file type badge comes from the asset's name or MIME type. An optional
 * image is revealed on hover (lazy). When the asset is not in the map — none
 * chosen, deleted, or private — customers get nothing and the preview a
 * warning (spec edge case).
 */

const DEFAULT_LABEL = 'Download';
/** R20E (T303): a tile linking to a page reads "Learn more" unless the editor writes another label. */
const DEFAULT_PAGE_LABEL = 'Learn more';

/** A short file type for the badge: the file name's extension, else the MIME subtype. */
function fileType(asset: CmsRenderAsset): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(asset.filename ?? '')?.[1];
  const fromUrl = /\.([a-z0-9]{1,8})(?:[?#].*)?$/i.exec(asset.url)?.[1];
  const fromMime = asset.mimeType?.split('/')[1]?.split(/[+.;-]/)[0];
  return (fromName ?? fromUrl ?? fromMime ?? '').toUpperCase();
}

const SCHEMES = new Set(['light', 'muted', 'dark']);

/**
 * R19B (T247, T248): the card's look as custom properties, only what is set —
 * background, corners, padding. R20E (T301): the minimum height. R23 (T437,
 * T444): the padding is one spacing step, the minimum height one value (a
 * value stored per breakpoint reads as its desktop value, else its base); the
 * icon button's size and ring colour and the subtitle's size and colour were
 * removed. `null` when nothing is set.
 */
function lookStyle(props: DownloadTileProps, tier: BreakpointTier | null): CSSProperties | null {
  const background = colorValueToCss(props.cardBackground);
  const radius = props.cornerRadius ? CORNER_RADIUS_PX[props.cornerRadius] : undefined;
  const style: Record<string, string> = {
    ...(background ? { '--pb-dl-bg': background } : {}),
    ...(typeof radius === 'number' ? { '--pb-dl-radius': `${radius}px` } : {}),
    ...spaceTokenVars('pb-dl-pad', props.cardPadding, tier),
    ...(responsivePxVars('dl-min-h', singleWeight(props.minHeightPx), tier, { min: 0, max: 1200 }) ?? {}),
  };
  return Object.keys(style).length > 0 ? (style as CSSProperties) : null;
}

/** Today's title (`.cmsc-pb-download-tile__title`): 1.125 rem, 600, at 1.3 — read by a breakpoint left on Default. */
const TITLE_TODAY = { size: '1.125rem', weight: '600', lineHeight: '1.3' };

/**
 * R23 (T444): the title's size — a type token or Custom px (`titleSize`); a
 * Custom px stored by R19B without a size (`titleSizePx` alone) reads as Custom.
 */
function titleSizeOf(props: DownloadTileProps): TextStyleValues['size'] {
  if (props.titleSize !== undefined && props.titleSize !== null) return props.titleSize as TextStyleValues['size'];
  return props.titleSizePx !== undefined && props.titleSizePx !== null ? 'custom' : undefined;
}

function DownloadTileBody({
  props,
  preview,
  tier = null,
}: {
  props: DownloadTileProps;
  preview: boolean;
  tier?: BreakpointTier | null;
}): ReactNode {
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  // Feature 167 — an internal link takes the page language's prefix.
  const localizePath = useCmsRenderLocalizePath();
  // R20E (T303): the tile links to a page, a product, a URL… (the shared link) instead of a file.
  const pageLink = props.linkTo === 'link';
  const asset = !pageLink && props.fileAssetId ? assets[props.fileAssetId] : undefined;
  const target = pageLink ? resolveLinkHref(props.link, { assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}), localizePath }) : null;
  const title = props.title?.trim() ?? '';
  const subtitle = props.subtitle?.trim() ?? '';
  const label = props.linkLabel?.trim() || (pageLink ? DEFAULT_PAGE_LABEL : DEFAULT_LABEL);

  if (pageLink ? !target : !asset?.url) {
    if (!preview) return null;
    return (
      <div role="note" className="cmsc-pb-download-tile cmsc-pb-download-tile--missing">
        <span className="cmsc-pb-download-tile__title">{title || 'Download tile'}</span>
        <span className="cmsc-pb-download-tile__warning">
          {pageLink
            ? 'Choose a link: a page, a product, a category or a URL.'
            : props.fileAssetId
              ? 'The file is no longer in the asset library. Choose another.'
              : 'Choose a file from the asset library.'}
        </span>
      </div>
    );
  }

  const type = props.showType === false || !asset ? '' : fileType(asset);
  const hover = props.hoverImage;
  const hasHover = hasImage(hover);
  // R19B (T248): the link drawn as a round icon button; its label stays the link's text for screen readers.
  const iconLink = props.linkLook === 'icon';
  const scheme = typeof props.scheme === 'string' && SCHEMES.has(props.scheme) ? props.scheme : null;
  const style = lookStyle(props, tier);
  // R21G (T338): the title's own weight; unset or Default, today's. R23 (T444): its size, a token or Custom px.
  const titleLook = textStyleAttrs({ size: titleSizeOf(props), sizePx: props.titleSizePx, weight: props.titleWeight }, tier, TITLE_TODAY);
  const classes = [
    'cmsc-pb-download-tile',
    hasHover ? 'cmsc-pb-download-tile--hover-image' : '',
    hasHover && props.hoverImageLook === 'full' ? 'cmsc-pb-download-tile--hover-full' : '',
    props.cardBorder === false ? 'cmsc-pb-download-tile--no-border' : '',
    iconLink ? 'cmsc-pb-download-tile--icon-link' : '',
    // Feature 169 (US4): the icon button's size and style presets; unset or outline, today's.
    iconLink && ICON_BUTTON_SIZES.has(props.iconButtonSize as string) ? `cmsc-pb-download-tile--icon-${props.iconButtonSize as string}` : '',
    iconLink && props.iconButtonStyle === 'filled' ? 'cmsc-pb-download-tile--icon-filled' : '',
    pageLink ? 'cmsc-pb-download-tile--page-link' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // R20E (T303): a page link's icon button points onwards; a file's downloads.
  // R22I (T382): or a glyph of the catalog the editor chose (an unknown name keeps today's).
  const DownloadIcon = resolveCmsIcon(props.iconButtonIcon) ?? (pageLink ? CMS_ICON_CATALOG.arrowRight : CMS_ICON_CATALOG.download);
  const linkAttributes = target
    ? { href: target.href, ...(target.target ? { target: target.target } : {}), ...(target.rel ? { rel: target.rel } : {}) }
    : { href: absolutizeMediaUrl(asset!.url, mediaBaseUrl), download: asset!.filename ?? '' };
  return (
    <a
      className={classes}
      {...linkAttributes}
      {...(scheme ? { 'data-cmsb-scheme': scheme } : {})}
      {...(style ? { style } : {})}
      {...itemTagsAttribute(props.tags)}
    >
      {hasHover ? (
        <span className="cmsc-pb-download-tile__hover">
          <Picture image={{ fit: 'cover', ...hover } as Partial<ResponsiveImage>} />
        </span>
      ) : null}
      <span className="cmsc-pb-download-tile__text">
        {type ? <span className="cmsc-pb-download-tile__type">{type}</span> : null}
        {title ? (
          <span
            className={['cmsc-pb-download-tile__title', ...titleLook.classes].join(' ')}
            {...(Object.keys(titleLook.style).length > 0 ? { style: titleLook.style as CSSProperties } : {})}
          >
            {title}
          </span>
        ) : null}
        {subtitle ? <span className="cmsc-pb-download-tile__subtitle">{subtitle}</span> : null}
      </span>
      {iconLink ? (
        <>
          <span className="cmsc-pb-download-tile__label cmsc-sr-only">{label}</span>
          <span className="cmsc-pb-download-tile__icon-button" aria-hidden="true">
            <DownloadIcon className="cmsc-pb-download-tile__icon" aria-hidden="true" focusable="false" />
          </span>
        </>
      ) : (
        <span className="cmsc-pb-download-tile__label">{label}</span>
      )}
    </a>
  );
}

const DownloadTileRender: PuckComponent<DownloadTileProps> = (props) => {
  const environment = useBlockRenderEnvironment();
  const previewTier = usePreviewBreakpointTier();
  const editing = props.puck?.isEditing === true;
  return (
    <DownloadTileBody
      props={props as unknown as DownloadTileProps}
      preview={environment.preview || editing}
      tier={editing ? previewTier : null}
    />
  );
};

/** Feature 169 (US4): the icon button's size presets. */
const ICON_BUTTON_SIZES: ReadonlySet<string> = new Set(['s', 'm', 'l']);

const DOWNLOAD_TILE_FIELDS = {
  // R20E (T303): a file (today's) or a page, product, category or URL through the shared link.
  linkTo: {
    type: 'select' as const,
    label: 'Links to',
    options: [
      { label: 'A file', value: 'file' },
      { label: 'A page or URL', value: 'link' },
    ],
  },
  fileAssetId: { type: 'text' as const, label: 'File (asset ID)' },
  link: { ...BUTTON_SPEC_OBJECT_FIELDS.link, label: 'Link' },
  title: { type: 'text' as const, label: 'Title' },
  subtitle: { type: 'text' as const, label: 'Subtitle' },
  linkLabel: { type: 'text' as const, label: 'Link label' },
  hoverImage: imageObjectField('Image shown on hover'),
  // R19B (T248): the hover image faint (today's) or in full under a dark gradient.
  hoverImageLook: {
    type: 'select' as const,
    label: 'Image on hover',
    options: [
      { label: 'Faint tint', value: 'faint' },
      { label: 'Full image with a dark gradient', value: 'full' },
    ],
  },
  // R19B (T248): the link as today's text label or a round icon button at the bottom end.
  linkLook: {
    type: 'select' as const,
    label: 'Link look',
    options: [
      { label: 'Text label', value: 'label' },
      { label: 'Round icon button', value: 'icon' },
    ],
  },
  // R22I (T382): the icon button's glyph from the catalog; empty keeps today's (a download, or an arrow for a link).
  iconButtonIcon: createIconPickerField('Icon button icon'),
  // Feature 169 (US4): the icon button's size and style, presets only (R23: no px, no colour).
  iconButtonSize: {
    type: 'select' as const,
    label: 'Icon button size',
    options: [
      { label: 'Small', value: 's' },
      { label: 'Medium', value: 'm' },
      { label: 'Large', value: 'l' },
    ],
  },
  iconButtonStyle: {
    type: 'select' as const,
    label: 'Icon button style',
    options: [
      { label: 'Outline', value: 'outline' },
      { label: 'Filled', value: 'filled' },
    ],
  },
  showType: createToggleField({ label: 'Show the file type', defaultValue: true }),
  // R19B (T247): the card's look; unset is today's light, bordered 8 px card.
  scheme: {
    type: 'select' as const,
    label: 'Card color scheme',
    options: [
      { label: 'As the section', value: 'inherit' },
      { label: 'Light', value: 'light' },
      { label: 'Muted', value: 'muted' },
      { label: 'Dark', value: 'dark' },
    ],
  },
  cardBackground: createColorField({ label: 'Card background' }),
  cardBorder: createToggleField({ label: 'Card border', defaultValue: true }),
  cornerRadius: CORNER_RADIUS_FIELD,
  // R23 (T444): the title's size, a type token or Custom px (the established pattern); Default keeps today's.
  titleSize: sizeFieldWithDefault('Title size'),
  titleSizePx: sizePxField('Custom title size (px)', 10, 120),
  // R21G (T338): the title's weight; Default keeps today's.
  titleWeight: textWeightField('Title weight'),
  // R23 (T437): the card's padding, one spacing step; Default keeps today's 20 px.
  cardPadding: spaceTokenField('Card padding'),
  // R20E (T301): the card's minimum height — R23 (T444): one value for every breakpoint.
  minHeightPx: {
    type: 'number' as const,
    label: 'Custom minimum height (px)',
    min: 0,
    max: 1200,
  },
  // T131: tags for the Carousel's filter.
  tags: ITEM_TAGS_FIELD,
};

/** R19B (T248): the icon button's settings with the icon look; the hover look with a hover image. */
const ICON_BUTTON_KEYS = new Set(['iconButtonIcon', 'iconButtonSize', 'iconButtonStyle']);

/** Whether a size (one or per breakpoint) is Custom somewhere. */
function usesCustomSize(value: unknown): boolean {
  if (value === 'custom') return true;
  return value !== null && typeof value === 'object' && Object.values(value as Record<string, unknown>).includes('custom');
}

const downloadTileConfig: ComponentConfig<{ props: DownloadTileProps }> = {
  label: 'Download tile',
  fields: DOWNLOAD_TILE_FIELDS as unknown as Fields<DownloadTileProps>,
  defaultProps: {
    fileAssetId: '',
    title: 'Document',
    subtitle: '',
    linkLabel: DEFAULT_LABEL,
  } as DownloadTileProps,
  resolveFields: (data, params) => {
    const props = data.props as DownloadTileProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? DOWNLOAD_TILE_FIELDS)) {
      if (ICON_BUTTON_KEYS.has(key) && props.linkLook !== 'icon') continue;
      if (key === 'hoverImageLook' && !hasImage(props.hoverImage)) continue;
      // R20E (T303): the file or the link, as the tile's target says.
      if (key === 'fileAssetId' && props.linkTo === 'link') continue;
      if (key === 'link' && props.linkTo !== 'link') continue;
      if (key === 'titleSizePx' && titleSizeOf(props) !== 'custom' && !usesCustomSize(props.titleSize)) continue;
      fields[key] = field;
    }
    return fields as unknown as Fields<DownloadTileProps>;
  },
  // R23 (T444): a title Custom px stored by R19B without a size is shown as the Custom size it renders as.
  resolveData: async (data) => {
    const props = data.props as DownloadTileProps;
    if ((props.titleSize === undefined || props.titleSize === null) && titleSizeOf(props) === 'custom') {
      return { props: { ...props, titleSize: 'custom' } as never };
    }
    return { props: props as never };
  },
  render: DownloadTileRender,
};

export const DownloadTile = withHideOn(downloadTileConfig);
