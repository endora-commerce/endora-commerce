'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface CarouselShellProps {
  children: ReactNode;
  slidesPerView?: number;
  gap?: number;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  className?: string;
  /** When true, children is a Puck slot — slides are dropzone direct children. */
  slotMode?: boolean;
}

export function CarouselShell({
  children,
  slidesPerView = 1,
  gap = 16,
  autoplay = false,
  intervalMs = 5000,
  showArrows = true,
  showDots = true,
  className = '',
  slotMode = false,
}: CarouselShellProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activePage, setActivePage] = useState(0);

  const getScrollEl = useCallback((): HTMLElement | null => {
    const track = trackRef.current;
    if (!track) return null;
    if (slotMode) return track.querySelector('[data-puck-dropzone]') as HTMLElement | null;
    return track;
  }, [slotMode]);

  const getSlideCount = useCallback((): number => {
    const el = getScrollEl();
    if (!el) return 1;
    if (slotMode) return el.children.length || 1;
    return Array.isArray(children) ? children.length : 1;
  }, [getScrollEl, slotMode, children]);

  const childCount = getSlideCount();
  const perView = Math.max(1, slidesPerView);
  const pageCount = Math.max(1, Math.ceil(childCount / perView));

  const scrollToPage = useCallback(
    (pageIndex: number): void => {
      const track = trackRef.current;
      const el = getScrollEl();
      if (!track || !el) return;
      const page = Math.max(0, Math.min(pageIndex, pageCount - 1));
      const pageWidth = track.clientWidth;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const target = Math.min(page * pageWidth, maxScroll);
      track.scrollTo({ left: target, behavior: 'smooth' });
      setActivePage(page);
    },
    [getScrollEl, pageCount],
  );

  const scrollByDir = useCallback(
    (dir: -1 | 1): void => {
      const next = (activePage + dir + pageCount) % pageCount;
      scrollToPage(next);
    },
    [activePage, pageCount, scrollToPage],
  );

  useEffect(() => {
    setActivePage((page) => Math.min(page, pageCount - 1));
  }, [pageCount, perView, childCount]);

  useEffect(() => {
    if (!autoplay || pageCount <= 1) return;
    const id = window.setInterval(() => scrollByDir(1), intervalMs);
    return () => window.clearInterval(id);
  }, [autoplay, intervalMs, pageCount, scrollByDir]);

  const basis = `${100 / perView}%`;

  return (
    <div className={`cmsc-pb-carousel ${className}`.trim()}>
      <div className="cmsc-pb-carousel__viewport cmsc:relative">
        {showArrows && pageCount > 1 ? (
          <>
            <button
              type="button"
              className="cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--prev"
              aria-label="Previous slide"
              onClick={() => scrollByDir(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--next"
              aria-label="Next slide"
              onClick={() => scrollByDir(1)}
            >
              ›
            </button>
          </>
        ) : null}
        <div
          ref={trackRef}
          className={`cmsc-pb-carousel__track${slotMode ? ' cmsc-pb-carousel__track--slot' : ''}`}
          style={{ gap: slotMode ? undefined : `${gap}px`, ['--slide-basis' as string]: basis }}
          onScroll={(e) => {
            const track = e.currentTarget;
            const pageWidth = track.clientWidth;
            if (pageWidth <= 0) return;
            const page = Math.min(pageCount - 1, Math.round(track.scrollLeft / pageWidth));
            setActivePage(page);
          }}
        >
          {slotMode ? (
            children
          ) : Array.isArray(children) ? (
            children.map((child, i) => (
              <div key={i} className="cmsc-pb-carousel__slide" style={{ flex: `0 0 calc(${basis} - ${gap}px)` }}>
                {child}
              </div>
            ))
          ) : (
            <div className="cmsc-pb-carousel__slide" style={{ flex: `0 0 calc(${basis} - ${gap}px)` }}>
              {children}
            </div>
          )}
        </div>
      </div>
      {showDots && pageCount > 1 ? (
        <div className="cmsc-pb-carousel__dots" role="tablist">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activePage}
              aria-label={`Page ${i + 1}`}
              className={`cmsc-pb-carousel__dot${i === activePage ? ' cmsc-pb-carousel__dot--active' : ''}`}
              onClick={() => scrollToPage(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
