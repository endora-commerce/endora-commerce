'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { getSlotZoneItemCount } from '@b2b/page-builder-core/editor/puck-guards';
import { useEditorCarouselPage } from '@b2b/page-builder-core/editor/carousel-preview';
import { usePageBuilderPuck } from '@b2b/page-builder-core/editor/use-page-builder-puck';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ContentSliderProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  DEFAULT_LAYOUT_PADDING,
} from '../fields/shared-fields.js';
import { CarouselShell } from './carousel/CarouselShell.js';
import { CONTENT_SLIDER_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';

function slidesPerViewForTier(_tier: 'mobile' | 'tablet' | 'desktop'): number {
  return 1;
}

const ContentSliderEditingRender: PuckComponent<ContentSliderProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const {
    slides: Slides,
    slidesPerView = 1,
    gap = 16,
    autoplay = false,
    intervalMs = 5000,
    showArrows = true,
    showDots = true,
    equalHeight = true,
    ...box
  } = props;
  const perView = Math.max(1, Math.round(resolveResponsiveNumber(slidesPerView, tier, slidesPerViewForTier(tier))));
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const Slot = Slides as React.ComponentType<typeof CONTENT_SLIDER_SLOT_EDIT_PROPS>;
  const sliderId = props.id;
  const previewPage = useEditorCarouselPage(sliderId);
  const editorSlideCount = usePageBuilderPuck((state) =>
    getSlotZoneItemCount(state.appState.data, `${sliderId}:slides`),
  );

  return (
    <BoxStyled {...box} previewTier={tier}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        equalHeight={equalHeight}
        slotMode
        editorPreview
        previewPage={previewPage}
        editorCarouselId={sliderId}
        editorSlideCount={editorSlideCount}
      >
        <Slot {...CONTENT_SLIDER_SLOT_EDIT_PROPS} />
      </CarouselShell>
    </BoxStyled>
  );
};

const ContentSliderPublishedRender: PuckComponent<ContentSliderProps> = (props) => {
  const tier = useViewportBreakpointTier();
  const {
    slides: Slides,
    slidesPerView = 1,
    gap = 16,
    autoplay = false,
    intervalMs = 5000,
    showArrows = true,
    showDots = true,
    equalHeight = true,
    ...box
  } = props;
  const perView = Math.max(1, Math.round(resolveResponsiveNumber(slidesPerView, tier, slidesPerViewForTier(tier))));
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const Slot = Slides as React.ComponentType<{ className?: string }>;

  return (
    <BoxStyled {...box}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        equalHeight={equalHeight}
        slotMode
      >
        <Slot className="cmsc-pb-content-slider-slot" />
      </CarouselShell>
    </BoxStyled>
  );
};

const contentSliderConfig: ComponentConfig<ContentSliderProps> = {
  label: 'Content slider',
  fields: {
    slides: {
      type: 'slot',
      label: 'Slides',
      // Row is accepted then wrapped into a Slide by the page-builder onAction handler.
      allow: ['Slide', 'Row'],
      disallow: ['Column', 'ContentSlider'],
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
    slides: [],
    slidesPerView: 1,
    gap: 16,
    autoplay: false,
    intervalMs: 5000,
    showArrows: true,
    showDots: true,
    equalHeight: true,
    ...DEFAULT_BOX_PROPS,
    padding: DEFAULT_LAYOUT_PADDING,
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <ContentSliderEditingRender {...props} />
    ) : (
      <ContentSliderPublishedRender {...props} />
    ),
};

export const ContentSlider = withHideOn(contentSliderConfig);
