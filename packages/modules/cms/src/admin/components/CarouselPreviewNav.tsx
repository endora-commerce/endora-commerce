'use client';

import { useEffect, type ReactElement } from 'react';
import { ActionBar } from '@measured/puck';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  carouselEditorPageCount,
  setEditorCarouselPage,
  useEditorCarouselPage,
} from '@endora-commerce/page-builder-core/editor';
import { QuickTooltip } from '@endora-commerce/page-builder-admin';

export function CarouselPreviewNav({
  carouselId,
  slideCount,
  slidesPerView,
  onNavigate,
}: {
  carouselId: string;
  slideCount: number;
  slidesPerView: number;
  /**
   * When provided, owns page changes (e.g. Content Slider locks preview so
   * selection sync cannot snap back). Otherwise updates the shared page store.
   */
  onNavigate?: (page: number) => void;
}): ReactElement | null {
  const pageCount = carouselEditorPageCount(slideCount, slidesPerView);
  const page = useEditorCarouselPage(carouselId);

  useEffect(() => {
    if (page < pageCount) return;
    const clamped = Math.max(0, pageCount - 1);
    if (onNavigate) onNavigate(clamped);
    else setEditorCarouselPage(carouselId, clamped);
  }, [carouselId, page, pageCount, onNavigate]);

  if (pageCount <= 1) return null;

  const go = (direction: -1 | 1): void => {
    const next = (page + direction + pageCount) % pageCount;
    if (onNavigate) onNavigate(next);
    else setEditorCarouselPage(carouselId, next);
  };

  return (
    <>
      <QuickTooltip text="Previous slide page">
        <ActionBar.Action label="Previous slide page" onClick={(): void => go(-1)}>
          <ChevronLeft size={16} />
        </ActionBar.Action>
      </QuickTooltip>
      <ActionBar.Label label={`Page ${page + 1} / ${pageCount}`} />
      <QuickTooltip text="Next slide page">
        <ActionBar.Action label="Next slide page" onClick={(): void => go(1)}>
          <ChevronRight size={16} />
        </ActionBar.Action>
      </QuickTooltip>
    </>
  );
}
