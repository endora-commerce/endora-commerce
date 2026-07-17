'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_ITEMS_METADATA,
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { useEditorCarouselPage } from '@b2b/page-builder-core/editor/carousel-preview';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ImageSliderProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CarouselShell } from './carousel/CarouselShell.js';
import { useCmsRenderAssets, useCmsRenderMediaBaseUrl } from './render-context.js';
import { resolveImageUrl } from '../utils/resolve-image-url.js';

function slidesPerViewForTier(tier: 'mobile' | 'tablet' | 'desktop'): number {
  if (tier === 'desktop') return 8;
  if (tier === 'tablet') return 4;
  return 1;
}

function titlePlacementClass(placement: ImageSliderProps['items'][number]['titlePlacement']): string {
  if (!placement || placement === 'none') return '';
  return `cmsc-pb-image-slider__title--${placement}`;
}

function ImageSliderBody({
  props,
  tier,
  editing,
  previewPage = 0,
}: {
  props: ImageSliderProps & { id?: string; puck?: { isEditing?: boolean } };
  tier: 'mobile' | 'tablet' | 'desktop';
  editing: boolean;
  previewPage?: number;
}): React.ReactElement {
  const {
    items = [],
    slidesPerView = { base: 1, tablet: 4, desktop: 8 },
    gap = 16,
    autoplay = false,
    intervalMs = 5000,
    showArrows = true,
    showDots = true,
    equalHeight = true,
    puck: _puck,
    ...box
  } = props;
  const assets = useCmsRenderAssets();
  const mediaBaseUrl = useCmsRenderMediaBaseUrl();
  const perView = Math.max(1, Math.round(resolveResponsiveNumber(slidesPerView, tier, slidesPerViewForTier(tier))));
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const carouselId = typeof props.id === 'string' ? props.id : undefined;

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">
          {editing ? 'Add slides in the Items tab.' : null}
        </p>
      </BoxStyled>
    );
  }

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: tier } : {})}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        equalHeight={equalHeight}
        editorPreview={editing}
        previewPage={editing ? previewPage : 0}
        {...(editing && carouselId !== undefined ? { editorCarouselId: carouselId } : {})}
      >
        {items.map((item, index) => {
          const src = resolveImageUrl(item, tier, assets, mediaBaseUrl);
          const showTitle = Boolean(item.title?.trim()) && item.titlePlacement !== 'none';
          return (
            <div key={index} className="cmsc-pb-carousel__slide cmsc-pb-image-slider__slide">
              {src ? (
                <img
                  src={src}
                  alt={item.title?.trim() || ''}
                  className="cmsc-pb-image-slider__image"
                />
              ) : (
                <div className="cmsc-pb-image-slider__placeholder">Add an image</div>
              )}
              {showTitle ? (
                <div className={`cmsc-pb-image-slider__title ${titlePlacementClass(item.titlePlacement)}`}>
                  {item.title}
                </div>
              ) : null}
            </div>
          );
        })}
      </CarouselShell>
    </BoxStyled>
  );
}

const ImageSliderEditingRender: PuckComponent<ImageSliderProps> = (props) => {
  const carouselId = (props as ImageSliderProps & { id?: string }).id;
  const previewPage = useEditorCarouselPage(carouselId);
  return <ImageSliderBody props={props} tier={usePreviewBreakpointTier()} editing previewPage={previewPage} />;
};

const ImageSliderPublishedRender: PuckComponent<ImageSliderProps> = (props) => (
  <ImageSliderBody props={props} tier={useViewportBreakpointTier()} editing={false} />
);

const TITLE_PLACEMENT_OPTIONS = [
  { label: 'Hidden', value: 'none' },
  { label: 'Top left', value: 'top-left' },
  { label: 'Top center', value: 'top-center' },
  { label: 'Top right', value: 'top-right' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom left', value: 'bottom-left' },
  { label: 'Bottom center', value: 'bottom-center' },
  { label: 'Bottom right', value: 'bottom-right' },
] as const;

const imageSliderConfig: ComponentConfig<ImageSliderProps> = {
  label: 'Image slider',
  fields: {
    items: {
      type: 'array',
      label: 'Slides',
      metadata: PB_ITEMS_METADATA,
      arrayFields: {
        imageSource: {
          type: 'select',
          label: 'Image source',
          options: [
            { label: 'URL', value: 'url' },
            { label: 'Asset library', value: 'library' },
          ],
        },
        src: { type: 'text', label: 'Image URL' },
        assetId: { type: 'text', label: 'Asset' },
        title: { type: 'text', label: 'Title' },
        titlePlacement: {
          type: 'select',
          label: 'Title placement',
          options: [...TITLE_PLACEMENT_OPTIONS],
        },
      },
      defaultItemProps: {
        imageSource: 'url',
        src: '',
        assetId: '',
        title: '',
        titlePlacement: 'bottom-center',
      },
    },
    slidesPerView: {
      type: 'select',
      label: 'Slides per view',
      metadata: PB_RESPONSIVE_METADATA,
      options: [
        { label: '1', value: 1 },
        { label: '2', value: 2 },
        { label: '3', value: 3 },
        { label: '4', value: 4 },
        { label: '5', value: 5 },
        { label: '6', value: 6 },
        { label: '7', value: 7 },
        { label: '8', value: 8 },
      ],
    },
    gap: {
      type: 'number',
      label: 'Gap (px)',
      min: 0,
      max: 48,
      metadata: PB_RESPONSIVE_METADATA,
    },
    autoplay: { type: 'radio', label: 'Autoplay', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
    intervalMs: { type: 'number', label: 'Autoplay interval (ms)', min: 2000, max: 15000 },
    showArrows: { type: 'radio', label: 'Arrows', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
    showDots: { type: 'radio', label: 'Dots', options: [{ label: 'Show', value: true }, { label: 'Hide', value: false }] },
    equalHeight: {
      type: 'radio',
      label: 'Equal slide height',
      options: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
  },
  defaultProps: {
    items: [{ imageSource: 'url', src: '', assetId: '', title: '', titlePlacement: 'bottom-center' }],
    slidesPerView: { base: 1, tablet: 4, desktop: 8 },
    gap: 16,
    autoplay: false,
    intervalMs: 5000,
    showArrows: true,
    showDots: true,
    equalHeight: true,
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <ImageSliderEditingRender {...props} />
    ) : (
      <ImageSliderPublishedRender {...props} />
    ),
};

export const ImageSlider = withHideOn(imageSliderConfig);
