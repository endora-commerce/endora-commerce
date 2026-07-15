'use client';

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

const SLIDE_EASING = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Feature 002 US3 — label-aware product gallery for the PDP.
 *
 * Industria design (`specs/b2b-platform-storefront-ui/project`): a square main
 * viewport with a "Powiększ" zoom pill, and a thumbnail strip — placed **below**
 * the main view (the reference mock keeps them on the left; this storefront
 * moves them under the image per product decision). Photos and videos share the
 * strip; a video thumbnail carries a play glyph and plays with controls in the
 * main view.
 *
 * Navigation: prev/next arrows over the main view + clickable thumbnails. The
 * main stage is a Fotorama-style horizontal carousel — every slide lives in one
 * flex track and navigating shifts the track by whole viewport widths, so the
 * outgoing photo slides out while the incoming one slides in (`.gallery-track`
 * owns the easing). The zoom pill opens a lightbox over the active image.
 *
 * Base Image is the default main view; the Small Image thumbnail is marked
 * for themes/tests. Rendered server-side too (initial active = primary), so a
 * no-JS load still shows the correct main image + full strip.
 */

export type GalleryLabel = 'base_image' | 'small_image' | 'thumbnail';

export interface GallerySwitcherItem {
  id: string;
  position: number;
  labels: GalleryLabel[];
  asset: { id: string; kind: string; url: string };
}

function PlayGlyph({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GallerySwitcher(rawProps: {
  gallery: GallerySwitcherItem[];
  alt: string;
}): ReactNode {
  // Host-relative asset URLs (e.g. `/assets/file/<id>`) must be rebased onto the
  // public API origin, otherwise the browser resolves them against the
  // storefront origin and every image/video 404s. Normalise once here so every
  // render site (main view, thumbnails, lightbox, `data-active-src`) is covered.
  const props = {
    ...rawProps,
    gallery: rawProps.gallery.map((g) => ({
      ...g,
      asset: { ...g.asset, url: toAbsoluteAssetUrl(g.asset.url) },
    })),
  };
  const baseIndex = Math.max(
    0,
    props.gallery.findIndex((g) => g.labels.includes('base_image')),
  );
  const [index, setIndex] = useState(baseIndex);
  const [zoomed, setZoomed] = useState(false);
  // Reduced-motion is read client-side so the slide easing can be dropped
  // without depending on a stylesheet rule (dev-server CSS can lag the JS).
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const slideTransition = reduceMotion ? 'none' : SLIDE_EASING;

  if (props.gallery.length === 0) {
    return <div className="aspect-square rounded-md bg-surface-alt" aria-hidden="true" />;
  }

  const count = props.gallery.length;
  const safeIndex = Math.min(index, count - 1);
  const active = props.gallery[safeIndex]!;
  const activeIsVideo = active.asset.kind === 'video';

  const goTo = (next: number): void => {
    if (next < 0 || next >= count) return;
    setIndex(next);
  };

  // Touch swipe — a mostly-horizontal drag flips to the neighbouring slide.
  // Vertical drags are ignored here (and the viewport sets `touch-action: pan-y`)
  // so the page still scrolls normally under a finger on the image.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent): void => {
    const t = e.touches[0];
    if (t) touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: ReactTouchEvent): void => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      goTo(dx < 0 ? safeIndex + 1 : safeIndex - 1);
    }
  };

  // While the lightbox is open, lock body scroll, close on Escape, and let the
  // left/right arrow keys page through the gallery images.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setZoomed(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(0, Math.min(i, count - 1) - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => Math.min(count - 1, Math.min(i, count - 1) + 1));
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomed, count]);

  return (
    <div className="flex flex-col gap-3">
      {/* Main viewport — square panel (`.gallery__main`) with a sliding track. */}
      <div
        className="group relative aspect-square touch-pan-y overflow-hidden rounded-md border border-line bg-surface"
        data-active-src={active.asset.url}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="gallery-track flex h-full w-full"
          style={{
            transform: `translateX(-${safeIndex * 100}%)`,
            transition: slideTransition,
            willChange: 'transform',
          }}
        >
          {props.gallery.map((item, i) => {
            const isVideo = item.asset.kind === 'video';
            return (
              <div
                key={item.id}
                className="grid h-full w-full shrink-0 basis-full place-items-center"
                data-gallery-slide={i}
                {...(i === safeIndex ? { 'data-active': 'true' } : {})}
                aria-hidden={i === safeIndex ? undefined : 'true'}
              >
                {isVideo ? (
                  <video
                    src={item.asset.url}
                    className="h-full w-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={props.alt}
                  />
                ) : (
                  <img
                    className="h-full w-full rounded-md object-contain"
                    src={item.asset.url}
                    alt={props.alt}
                    loading={i === safeIndex ? 'eager' : 'lazy'}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Prev / next arrows — shown only with more than one item. Fade in on
            hover (always visible on touch, which has no hover state). */}
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => goTo(safeIndex - 1)}
              disabled={safeIndex === 0}
              aria-label="Poprzednie zdjęcie"
              className="absolute left-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 text-fg shadow-sm backdrop-blur transition-opacity hover:bg-surface disabled:pointer-events-none disabled:opacity-0 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <Chevron dir="left" />
            </button>
            <button
              type="button"
              onClick={() => goTo(safeIndex + 1)}
              disabled={safeIndex === count - 1}
              aria-label="Następne zdjęcie"
              className="absolute right-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 text-fg shadow-sm backdrop-blur transition-opacity hover:bg-surface disabled:pointer-events-none disabled:opacity-0 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <Chevron dir="right" />
            </button>
          </>
        ) : null}

        {!activeIsVideo ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-[6px] rounded-sm border border-line bg-surface px-[10px] py-[6px] text-[12px] text-muted transition-colors hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4M11 8v6M8 11h6" strokeLinecap="round" />
            </svg>
            Powiększ
          </button>
        ) : null}
      </div>

      {/* Thumbnail strip — BELOW the main view. Scrolls horizontally on phones
          so a long gallery never overflows the viewport (Industria Mobile §04). */}
      <ul className="m-0 flex list-none gap-2 touch-pan-x overflow-x-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {props.gallery.map((item, i) => {
          const isSmall = item.labels.includes('small_image');
          const isVideo = item.asset.kind === 'video';
          const isActive = i === safeIndex;
          return (
            <li
              key={item.id}
              className="shrink-0"
              {...(isSmall ? { 'data-small-image': 'true' } : {})}
            >
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={isActive ? 'true' : undefined}
                className={`relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-sm border bg-surface transition-colors ${
                  isActive ? 'border-fg' : 'border-line hover:border-line-strong'
                }`}
              >
                {isVideo ? (
                  <>
                    <video
                      className="h-full w-full object-cover"
                      src={item.asset.url}
                      muted
                      playsInline
                      preload="metadata"
                      aria-hidden="true"
                    />
                    <span className="absolute inset-0 grid place-items-center bg-black/25">
                      <PlayGlyph className="h-6 w-6 text-white" />
                    </span>
                  </>
                ) : (
                  <img
                    className="h-full w-full object-contain"
                    src={item.asset.url}
                    alt={props.alt}
                    loading="lazy"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Lightbox — opens over the active image via the zoom pill. Arrows here
          too, so the buyer can browse without leaving the enlarged view.
          Rendered through a portal to <body> so the fixed overlay escapes the
          gallery's transformed / will-change ancestors and truly fills the
          viewport (otherwise it is trapped inside the product card on mobile). */}
      {zoomed && !activeIsVideo && typeof document !== 'undefined'
        ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={props.alt}
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
        >
          <div
            className="relative grid h-full w-full touch-pan-y place-items-center overflow-hidden"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="gallery-track flex h-full w-full items-center"
              style={{ transform: `translateX(-${safeIndex * 100}%)`, transition: slideTransition }}
            >
              {props.gallery.map((item) => (
                <div key={item.id} className="grid h-full w-full shrink-0 basis-full place-items-center">
                  {item.asset.kind === 'video' ? null : (
                    // Cap by viewport units (not the `h-full` percentage chain,
                    // which collapses through the grid's auto-height track and
                    // lets tall images render at natural size). This guarantees
                    // the whole image is visible and centred on screen.
                    <img
                      src={item.asset.url}
                      alt={props.alt}
                      onClick={(e) => e.stopPropagation()}
                      className="max-h-[88vh] max-w-[92vw] rounded-md object-contain"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(safeIndex - 1);
                }}
                disabled={safeIndex === 0}
                aria-label="Poprzednie zdjęcie"
                className="absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
              >
                <Chevron dir="left" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(safeIndex + 1);
                }}
                disabled={safeIndex === count - 1}
                aria-label="Następne zdjęcie"
                className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
              >
                <Chevron dir="right" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Zamknij"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-2xl leading-none text-white hover:bg-white/20"
          >
            ×
          </button>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
