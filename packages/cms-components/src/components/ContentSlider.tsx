'use client';

import { type ComponentConfig, type PuckComponent } from '@measured/puck';
import {
  PB_RESPONSIVE_METADATA,
  resolveResponsiveNumber,
  withHideOn,
} from '@b2b/page-builder-core';
import { usePreviewBreakpointTier } from '@b2b/page-builder-core/client';
import type { ContentSliderProps } from '../schema/component-types.js';
import { useViewportBreakpointTier } from '../hooks/use-viewport-breakpoint-tier.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { CarouselShell } from './carousel/CarouselShell.js';

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
    ...box
  } = props;
  const perView = resolveResponsiveNumber(slidesPerView, tier, 1);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const Slot = Slides as React.ComponentType;

  return (
    <BoxStyled {...box} previewTier={tier}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        slotMode
      >
        <Slot />
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
    ...box
  } = props;
  const perView = resolveResponsiveNumber(slidesPerView, tier, 1);
  const gapPx = resolveResponsiveNumber(gap, tier, 16);
  const Slot = Slides as React.ComponentType;

  return (
    <BoxStyled {...box}>
      <CarouselShell
        slidesPerView={perView}
        gap={gapPx}
        autoplay={autoplay}
        intervalMs={intervalMs}
        showArrows={showArrows}
        showDots={showDots}
        slotMode
      >
        <Slot />
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
      disallow: ['Row'],
    },
    slidesPerView: {
      type: 'number',
      label: 'Slides per view',
      min: 1,
      max: 4,
      step: 0.1,
      metadata: PB_RESPONSIVE_METADATA,
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
    ...DEFAULT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? (
      <ContentSliderEditingRender {...props} />
    ) : (
      <ContentSliderPublishedRender {...props} />
    ),
};

export const ContentSlider = withHideOn(contentSliderConfig);
