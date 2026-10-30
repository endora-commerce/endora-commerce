'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Feature 169 (US5, FR-011, FR-013) — the scroll spy of `cms.PageNavigation`,
 * a progressive enhancement over the plain anchor links the server renders.
 *
 * - An `IntersectionObserver` watches the linked elements; the topmost one in
 *   the upper half of the viewport (below the storefront header and, when
 *   sticky, the bar) is the active one. When every one has left, the last
 *   stays active. Without an observer (an old browser) nothing is marked.
 * - Nothing is active until the island has mounted, so the server HTML and the
 *   first client render agree (no hydration mismatch).
 * - The active link is brought into view inside a list that scrolls sideways,
 *   only while the bar is fully on screen, with `block: 'nearest'`: the page
 *   itself never moves under the reader.
 * - A sticky bar writes its height to `--cmsc-page-nav-h` on the document
 *   element, which the stylesheet adds to a jump target's `scroll-margin-top`,
 *   and removes it when it goes.
 *
 * Elements are looked up in the bar's own document (`ownerDocument`), so the
 * hook also works inside the editor's preview iframe.
 */

export interface PageNavigationSpyOptions {
  /** The bar sticks to the top: its height offsets the observed area and the jump targets. */
  sticky: boolean;
  /** Off in the editor canvas, where the page does not scroll as on the storefront. */
  enabled: boolean;
}

/** The px value of a CSS length custom property on the document element; 0 when unset or not in px. */
function rootLengthPx(doc: Document, name: string): number {
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return 0;
  const value = Number.parseFloat(view.getComputedStyle(doc.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function precedes(a: Element, b: Element): boolean {
  // `compareDocumentPosition` answers a bit mask.
  return (a.compareDocumentPosition(b) & 2) !== 0; // Node.DOCUMENT_POSITION_PRECEDING: b comes before a.
}

/**
 * The active item's index (`-1`: none) and a setter for a followed link.
 * `anchors` are the rendered items' anchors, in their order.
 */
export function usePageNavigationSpy(
  navRef: RefObject<HTMLElement | null>,
  anchors: readonly string[],
  { sticky, enabled }: PageNavigationSpyOptions,
): [number, (index: number) => void] {
  const [active, setActive] = useState(-1);
  const anchorsKey = anchors.join(' ');

  useEffect(() => {
    const nav = navRef.current;
    if (!enabled || !nav) return undefined;
    const doc = nav.ownerDocument;
    // The bar's own window first (the editor's iframe has its own), else this realm's.
    const Observer = doc.defaultView?.IntersectionObserver ?? globalThis.IntersectionObserver;
    if (typeof Observer !== 'function') return undefined;
    const targets = anchorsKey.split(' ').map((anchor) => (anchor ? doc.getElementById(anchor) : null));
    const visible = new Set<Element>();
    const top = rootLengthPx(doc, '--cmsb-header-offset') + (sticky ? nav.getBoundingClientRect().height || 0 : 0);
    const observer = new Observer(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        let best = -1;
        targets.forEach((target, index) => {
          if (!target || !visible.has(target)) return;
          if (best === -1 || precedes(targets[best]!, target)) best = index;
        });
        if (best !== -1) setActive(best);
      },
      { rootMargin: `-${Math.round(top)}px 0px -50% 0px`, threshold: 0 },
    );
    const observed = new Set<Element>();
    for (const target of targets) {
      if (target && !observed.has(target)) {
        observed.add(target);
        observer.observe(target);
      }
    }
    return () => observer.disconnect();
  }, [navRef, anchorsKey, enabled, sticky]);

  // The active link, brought into view inside a list that scrolls sideways — never by moving the page.
  useEffect(() => {
    const nav = navRef.current;
    if (!enabled || !nav || active < 0) return;
    const list = nav.querySelector<HTMLElement>('.cmsc-pb-page-nav__list');
    const link = nav.querySelectorAll<HTMLElement>('.cmsc-pb-page-nav__link')[active];
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const viewportHeight = nav.ownerDocument.defaultView?.innerHeight ?? 0;
    if (box.top < 0 || box.bottom > viewportHeight) return;
    link.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [navRef, active, enabled]);

  // A sticky bar's height, for the jump targets' `scroll-margin-top`.
  useEffect(() => {
    const nav = navRef.current;
    if (!enabled || !sticky || !nav) return undefined;
    const root = nav.ownerDocument.documentElement;
    const write = (): void => {
      root.style.setProperty('--cmsc-page-nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
    };
    write();
    const Resize = nav.ownerDocument.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
    const resize = typeof Resize === 'function' ? new Resize(write) : null;
    resize?.observe(nav);
    return () => {
      resize?.disconnect();
      root.style.removeProperty('--cmsc-page-nav-h');
    };
  }, [navRef, enabled, sticky]);

  const follow = useCallback((index: number) => setActive(index), []);
  return [active, follow];
}
