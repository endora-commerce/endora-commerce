'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setEditorCarouselPage } from '@b2b/page-builder-core/editor/carousel-preview';

export interface CarouselShellProps {
  children: ReactNode;
  slidesPerView?: number;
  gap?: number;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  equalHeight?: boolean;
  className?: string;
  /** When true, children is a Puck slot — slides are dropzone / slot-root direct children. */
  slotMode?: boolean;
  /**
   * Editor canvas mode — no on-canvas arrows/autoplay so Puck drag/click works.
   * Use `previewPage` + action-bar / dots to change the visible page.
   */
  editorPreview?: boolean;
  /** Controlled page index when `editorPreview` is true. */
  previewPage?: number;
  /** Carousel id used when dots update the shared editor page store. */
  editorCarouselId?: string;
  /** Authoritative slide count from Puck data while editing slot carousels. */
  editorSlideCount?: number;
}

export function CarouselShell({
  children,
  slidesPerView = 1,
  gap = 16,
  autoplay = false,
  intervalMs = 5000,
  showArrows = true,
  showDots = true,
  equalHeight = false,
  className = '',
  slotMode = false,
  editorPreview = false,
  previewPage = 0,
  editorCarouselId,
  editorSlideCount,
}: CarouselShellProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const carouselUid = editorCarouselId ?? `pb-carousel-${reactId}`;
  const [activePage, setActivePage] = useState(0);
  const [slideCount, setSlideCount] = useState(1);
  const isProgrammaticScrollRef = useRef(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getSlideRow = useCallback((): HTMLElement | null => {
    const track = trackRef.current;
    if (!track) return null;
    if (!slotMode) return track;

    const dropzone =
      track.querySelector('[data-puck-dropzone$=":slides"]') ??
      track.querySelector('.cmsc-pb-content-slider-slot');
    if (dropzone instanceof HTMLElement) return dropzone;

    const slotRoot = track.firstElementChild;
    return slotRoot instanceof HTMLElement ? slotRoot : track;
  }, [slotMode]);

  const measureSlideCount = useCallback((): void => {
    if (slotMode) {
      const row = getSlideRow();
      if (!row) return;
      setSlideCount(Math.max(1, row.children.length));
      return;
    }
    setSlideCount(Array.isArray(children) ? Math.max(1, children.length) : 1);
  }, [getSlideRow, slotMode, children]);

  const perView = Math.max(1, slidesPerView);
  const measuredCount = Math.max(1, slideCount);
  const effectiveSlideCount =
    editorPreview && typeof editorSlideCount === 'number' && editorSlideCount > 0
      ? editorSlideCount
      : measuredCount;
  const pageCount = Math.max(1, Math.ceil(effectiveSlideCount / perView));
  const showArrowControls = !editorPreview && showArrows && pageCount > 1;
  const showDotControls = showDots && pageCount > 1;
  const enableAutoplay = !editorPreview && autoplay && pageCount > 1;
  const displayPage = editorPreview
    ? Math.max(0, Math.min(previewPage, pageCount - 1))
    : activePage;

  const editorVisibleRange = useMemo(() => {
    const start = displayPage * perView;
    return { start, end: start + perView };
  }, [displayPage, perView]);

  /** CSS-driven hide for editor — only the slides zone, never nested Slide content. */
  const editorPreviewStyle = useMemo((): string | null => {
    if (!editorPreview) return null;
    const { start, end } = editorVisibleRange;
    const root = `.cmsc-pb-carousel[data-pb-carousel-uid="${CSS.escape(carouselUid)}"]`;
    const slideParents = [
      `${root} [data-puck-dropzone$=":slides"]`,
      `${root} .cmsc-pb-content-slider-slot`,
      `${root} .cmsc-pb-carousel__track--slot > *:not(.cmsc-pb-carousel__slide)`,
    ];
    const selectors: string[] = [];
    for (const parent of slideParents) {
      if (start > 0) selectors.push(`${parent} > *:nth-child(-n+${start})`);
      selectors.push(`${parent} > *:nth-child(n+${end + 1})`);
    }
    if (start > 0) {
      selectors.push(`${root} .cmsc-pb-carousel__track > .cmsc-pb-carousel__slide:nth-child(-n+${start})`);
    }
    selectors.push(`${root} .cmsc-pb-carousel__track > .cmsc-pb-carousel__slide:nth-child(n+${end + 1})`);
    return `${selectors.join(',\n')} { display: none !important; }`;
  }, [editorPreview, editorVisibleRange, carouselUid]);

  const beginProgrammaticScroll = useCallback((): void => {
    if (scrollEndTimerRef.current) {
      clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = null;
    }
    isProgrammaticScrollRef.current = true;
  }, []);

  const endProgrammaticScroll = useCallback((): void => {
    isProgrammaticScrollRef.current = false;
  }, []);

  const scheduleProgrammaticScrollEnd = useCallback((): void => {
    if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = setTimeout(() => {
      scrollEndTimerRef.current = null;
      endProgrammaticScroll();
    }, 400);
  }, [endProgrammaticScroll]);

  const syncSlideStride = useCallback((): void => {
    const track = trackRef.current;
    if (!track || !slotMode || editorPreview) return;
    const width = track.clientWidth;
    if (width <= 0) return;
    const stride = Math.max(1, width / perView - (perView > 1 ? gap / perView : 0));
    track.style.setProperty('--slide-stride', `${stride}px`);
  }, [slotMode, perView, editorPreview, gap]);

  useLayoutEffect(() => {
    measureSlideCount();
    syncSlideStride();
  }, [measureSlideCount, syncSlideStride, effectiveSlideCount, children]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const ro = new ResizeObserver(() => {
      measureSlideCount();
      syncSlideStride();
    });
    ro.observe(track);

    const onScrollEnd = (): void => {
      if (!isProgrammaticScrollRef.current) return;
      if (scrollEndTimerRef.current) {
        clearTimeout(scrollEndTimerRef.current);
        scrollEndTimerRef.current = null;
      }
      endProgrammaticScroll();
    };

    track.addEventListener('scrollend', onScrollEnd);

    const row = getSlideRow();
    if (slotMode && row && row !== track) {
      const mo = new MutationObserver(() => measureSlideCount());
      mo.observe(row, { childList: true, subtree: false });
      return (): void => {
        ro.disconnect();
        mo.disconnect();
        track.removeEventListener('scrollend', onScrollEnd);
        if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
      };
    }

    return (): void => {
      ro.disconnect();
      track.removeEventListener('scrollend', onScrollEnd);
      if (scrollEndTimerRef.current) clearTimeout(scrollEndTimerRef.current);
    };
  }, [measureSlideCount, syncSlideStride, getSlideRow, slotMode, endProgrammaticScroll]);

  const scrollToPage = useCallback(
    (pageIndex: number, behavior: ScrollBehavior = 'smooth'): void => {
      const track = trackRef.current;
      if (!track) return;
      const page = Math.max(0, Math.min(pageIndex, pageCount - 1));
      const pageWidth = track.clientWidth;
      if (pageWidth <= 0) return;
      const target = page * pageWidth;
      beginProgrammaticScroll();
      setActivePage(page);
      track.scrollTo({ left: target, behavior });
      if (behavior === 'instant') {
        endProgrammaticScroll();
      } else {
        scheduleProgrammaticScrollEnd();
      }
    },
    [pageCount, beginProgrammaticScroll, endProgrammaticScroll, scheduleProgrammaticScrollEnd],
  );

  const scrollByDir = useCallback(
    (dir: -1 | 1): void => {
      const next = (activePage + dir + pageCount) % pageCount;
      scrollToPage(next, 'smooth');
    },
    [activePage, pageCount, scrollToPage],
  );

  useEffect(() => {
    setActivePage((page) => Math.min(page, pageCount - 1));
  }, [pageCount, perView, effectiveSlideCount]);

  const goToPage = useCallback(
    (pageIndex: number, behavior: ScrollBehavior = 'smooth'): void => {
      if (editorPreview) {
        if (editorCarouselId) setEditorCarouselPage(editorCarouselId, pageIndex);
        setActivePage(Math.max(0, Math.min(pageIndex, pageCount - 1)));
        return;
      }
      scrollToPage(pageIndex, behavior);
    },
    [editorPreview, editorCarouselId, pageCount, scrollToPage],
  );

  useEffect(() => {
    if (!enableAutoplay) return;
    const id = window.setInterval(() => scrollByDir(1), intervalMs);
    return () => window.clearInterval(id);
  }, [enableAutoplay, intervalMs, pageCount, scrollByDir]);

  const basis = `${100 / perView}%`;
  const carouselClass = [
    'cmsc-pb-carousel',
    editorPreview ? 'cmsc-pb-carousel--editor-preview' : '',
    equalHeight ? 'cmsc-pb-carousel--equal-height' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={carouselClass}
      data-pb-carousel-page={displayPage}
      data-pb-carousel-uid={carouselUid}
    >
      {editorPreviewStyle ? <style>{editorPreviewStyle}</style> : null}
      <div className="cmsc-pb-carousel__viewport cmsc:relative">
        {showArrowControls ? (
          <>
            <button
              type="button"
              className="cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--prev"
              aria-label="Previous slide"
              onClick={(): void => scrollByDir(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--next"
              aria-label="Next slide"
              onClick={(): void => scrollByDir(1)}
            >
              ›
            </button>
          </>
        ) : null}
        <div
          ref={trackRef}
          className={`cmsc-pb-carousel__track${slotMode ? ' cmsc-pb-carousel__track--slot' : ''}`}
          style={{
            gap: slotMode ? undefined : `${gap}px`,
            ['--slide-gap' as string]: `${gap}px`,
            ['--slide-basis' as string]: basis,
          }}
          onScroll={(e) => {
            if (editorPreview || isProgrammaticScrollRef.current) return;
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
              <div
                key={i}
                className="cmsc-pb-carousel__slide"
                style={{ flex: `0 0 calc(${basis} - ${gap * ((perView - 1) / perView)}px)` }}
              >
                {child}
              </div>
            ))
          ) : (
            <div
              className="cmsc-pb-carousel__slide"
              style={{ flex: `0 0 calc(${basis} - ${gap * ((perView - 1) / perView)}px)` }}
            >
              {children}
            </div>
          )}
        </div>
      </div>
      {showDotControls ? (
        <div className="cmsc-pb-carousel__dots" role="tablist">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === displayPage}
              aria-label={`Page ${i + 1}`}
              className={`cmsc-pb-carousel__dot${i === displayPage ? ' cmsc-pb-carousel__dot--active' : ''}`}
              onClick={(): void => goToPage(i, 'instant')}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
