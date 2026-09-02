'use client';

import { type ReactElement } from 'react';
import { resolveResponsiveNumber } from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import {
  getSlotZoneItemCount,
  usePageBuilderPuck,
} from '@endora-commerce/page-builder-core/editor';
import { CarouselPreviewNav } from './CarouselPreviewNav.js';
import { contentSliderSlidesZone } from './ContentSliderActionBarExtras.js';
import { isPuckItemType, safeGetPuckData, safeGetPuckItem } from './puck-safe.js';

function slidesPerViewFromProps(
  value: unknown,
  tier: 'mobile' | 'tablet' | 'desktop',
  fallback = 1,
): number {
  return Math.max(1, Math.round(resolveResponsiveNumber(value as never, tier, fallback)));
}

export function SliderPreviewActionBarExtras({
  carouselId,
  type,
}: {
  carouselId: string;
  type: 'ImageSlider' | 'ProductSlider' | 'ContentSlider';
}): ReactElement | null {
  const getItemById = usePageBuilderPuck((s) => s.getItemById);
  const data = usePageBuilderPuck((s) => safeGetPuckData(() => s.appState?.data));
  const tier = usePreviewBreakpointTier();
  const item = safeGetPuckItem(getItemById, carouselId);
  const isActive = isPuckItemType(item, type);

  if (!isActive || !data) return null;

  const props = item.props;
  const slidesPerView = slidesPerViewFromProps(props.slidesPerView, tier);

  const slideCount =
    type === 'ContentSlider'
      ? getSlotZoneItemCount(data, contentSliderSlidesZone(carouselId))
      : type === 'ImageSlider'
        ? Array.isArray(props.items)
          ? props.items.length
          : 0
        : Math.max(0, Number(props.limit ?? 12));

  return (
    <CarouselPreviewNav
      carouselId={carouselId}
      slideCount={slideCount}
      slidesPerView={slidesPerView}
    />
  );
}
