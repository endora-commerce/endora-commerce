'use client';

import { useEffect, type RefObject } from 'react';

/** Below the tablet tier (768 px) the mobile video is the one shown — the same query as `Picture`'s source. */
const MOBILE_MEDIA = '(max-width: 767.98px)';
const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';

/**
 * Plays a section's background video — `specs/163-page-builder-marketing-pages/`
 * research R-9, FR-012.
 *
 * The section renders its videos with `preload="none"` and no `autoplay`, one per
 * breakpoint (`data-bp="mobile"` and `"desktop"`, or a single `data-bp="all"`),
 * and CSS hides the one that does not apply. This effect starts the one that
 * applies, and only when every condition agrees:
 *
 * - `matchMedia` says which breakpoint applies;
 * - an `IntersectionObserver` says the section is on screen — with no observer,
 *   visibility cannot be known and nothing plays;
 * - `prefers-reduced-motion` is not set — under it nothing ever plays, and the
 *   poster stays.
 *
 * Every other video is paused. A breakpoint or motion-preference change while
 * the page is open is followed.
 *
 * `selector` picks the videos this element owns, below `ref`: a section owns
 * its background pair, not the videos of a block inside it, which that block
 * plays itself (a hero's media, T043).
 */
export function useBreakpointVideo(
  ref: RefObject<HTMLElement | null>,
  selector = 'video[data-bp]',
  /** R19C (T263): the query under which the mobile video plays; unset, below the tablet tier. */
  options?: { mobileMedia?: string },
): void {
  const mobileMedia = options?.mobileMedia ?? MOBILE_MEDIA;
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>(selector));
    if (videos.length === 0) return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;

    const mobile = window.matchMedia(mobileMedia);
    const reduced = window.matchMedia(REDUCED_MOTION_MEDIA);
    let visible = false;

    const sync = (): void => {
      const wanted = visible && !reduced.matches ? (mobile.matches ? 'mobile' : 'desktop') : null;
      for (const video of videos) {
        const breakpoint = video.dataset['bp'];
        const active = wanted !== null && (breakpoint === wanted || breakpoint === 'all');
        if (active) {
          if (video.paused) {
            // React does not reliably reflect `muted` as an attribute; an unmuted
            // video would be refused autoplay, so the property is set here.
            video.muted = true;
            // A refused autoplay is expected and not an error; `Promise.resolve`
            // also covers engines whose `play()` still returns nothing.
            void Promise.resolve(video.play()).catch(() => undefined);
          }
        } else if (!video.paused) {
          video.pause();
        }
      }
    };

    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        sync();
      });
    } catch {
      return undefined;
    }
    observer.observe(root);
    mobile.addEventListener('change', sync);
    reduced.addEventListener('change', sync);

    return () => {
      observer.disconnect();
      mobile.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
      for (const video of videos) if (!video.paused) video.pause();
    };
  }, [ref, selector, mobileMedia]);
}
