'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Client-side navigation feedback: a delayed top progress bar plus the live
 * region that announces the same thing to a screen reader.
 *
 * It replaces the route-level `loading.tsx` skeleton, which cannot survive: a
 * `loading.tsx` puts a Suspense boundary above the page, Next flushes the shell
 * before the page component resolves, and `notFound()` / `redirect()` then have
 * no status line left to set. This component adds no boundary of any kind, so
 * the page keeps deciding its own response status.
 *
 * The previous page's content stays on screen until the next one is ready.
 * That is Next's own no-`loading.tsx` behaviour and it is deliberate: measured
 * on this storefront (Slow 4G, 4x CPU, 390x844), a click-to-content navigation
 * runs 57-500 ms, and rendering a generic skeleton into that window *added*
 * ~270 ms to it because the router has to commit the fallback and tear the old
 * page down before it can commit the real one.
 *
 * Three timings, each with a reason:
 *
 * - `VISIBLE_AFTER_MS` (200) — nothing is shown at all below this. Most
 *   navigations finish first (Next prefetches in-viewport links and the
 *   storefront also ships Speculation Rules `prerender`), so an ungated
 *   indicator would be a flash on every click, and a placeholder that appears
 *   and vanishes inside ~120 ms reads as a glitch rather than as progress.
 * - `SLOW_AFTER_MS` (10_000) — Nielsen's limit for keeping attention on a task.
 *   Past it the announcement is upgraded so a screen-reader user is not left
 *   with one "loading" from ten seconds ago.
 * - `GIVE_UP_AFTER_MS` (30_000) — a click that never commits (a link to the
 *   current URL, a navigation the router refused) must not leave the bar and
 *   `aria-busy` set for the rest of the session.
 *
 * `useLinkStatus` is deliberately not used. It is `useContext(LinkStatusContext)`
 * — per `<Link>`, like `useFormStatus` is per `<form>` — so a global bar built
 * on it needs a pending child inside all 128 `<Link>` sites and still misses the
 * eight `router.push` calls and the browser's own back/forward. `useSearchParams`
 * is deliberately not used either: in a root-layout client component it demands
 * a Suspense boundary above every page, which is the exact defect this component
 * exists to stop re-introducing.
 */

const VISIBLE_AFTER_MS = 200;
const SLOW_AFTER_MS = 10_000;
const GIVE_UP_AFTER_MS = 30_000;
const COMMIT_POLL_MS = 100;

/** 0 = pending but silent, 1 = bar + announcement, 2 = still-loading announcement. */
type Level = 0 | 1 | 2;

const starts = new Set<() => void>();

/**
 * Report a navigation that did not start from a link — the `router.push` /
 * `router.replace` call sites. A `<Link>` click needs no call: the component
 * recognises it from the DOM event.
 */
export function startNavigation(): void {
  for (const start of starts) start();
}

/**
 * True when this click is one the App Router will take over. Every exclusion is
 * a case where the browser does its own thing and no in-page feedback is owed:
 * a modified click opens a tab, a cross-origin or `download` link leaves the
 * app, a hash-only link scrolls synchronously.
 */
export function isRouterHandledClick(
  event: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  anchor: { target: string; hasDownload: boolean; href: string },
  current: { origin: string; pathname: string; search: string },
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target !== '' && anchor.target !== '_self') return false;
  if (anchor.hasDownload) return false;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}

export function NavigationFeedback({
  label,
  slowLabel,
}: {
  /** Announced once the wait passes `VISIBLE_AFTER_MS`. */
  label: string;
  /** Announced once the wait passes `SLOW_AFTER_MS`. */
  slowLabel: string;
}): ReactNode {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [level, setLevel] = useState<Level>(0);
  const startedFrom = useRef<string | null>(null);

  const start = useCallback(() => {
    startedFrom.current = window.location.href;
    setLevel(0);
    setPending(true);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const handled = isRouterHandledClick(
        event,
        { target: anchor.target, hasDownload: anchor.hasAttribute('download'), href: anchor.href },
        window.location,
      );
      if (handled) start();
    };
    // Capture phase: the router's own handler stops propagation on some links.
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', start);
    starts.add(start);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', start);
      starts.delete(start);
    };
  }, [start]);

  // The router committed a new path. A search-only navigation does not move
  // `pathname`, which is what the poll below is for.
  useEffect(() => {
    setPending(false);
    setLevel(0);
    startedFrom.current = null;
  }, [pathname]);

  useEffect(() => {
    if (!pending) return undefined;
    const settle = (): void => {
      setPending(false);
      setLevel(0);
    };
    const visible = window.setTimeout(() => setLevel(1), VISIBLE_AFTER_MS);
    const slow = window.setTimeout(() => setLevel(2), SLOW_AFTER_MS);
    const giveUp = window.setTimeout(settle, GIVE_UP_AFTER_MS);
    const poll = window.setInterval(() => {
      if (startedFrom.current !== null && window.location.href !== startedFrom.current) settle();
    }, COMMIT_POLL_MS);
    return () => {
      window.clearTimeout(visible);
      window.clearTimeout(slow);
      window.clearTimeout(giveUp);
      window.clearInterval(poll);
    };
  }, [pending]);

  // `<main>` is server-rendered, so its busy state cannot be a prop without
  // turning the whole page subtree into a client component (Constitution VII).
  useEffect(() => {
    const main = document.getElementById('main-content');
    if (main === null) return undefined;
    if (level >= 1) main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
    return () => main.removeAttribute('aria-busy');
  }, [level]);

  const announcement = level === 2 ? slowLabel : level === 1 ? label : '';

  return (
    <>
      {level >= 1 ? <div className="b2b-progress" aria-hidden="true" /> : null}
      {/* Mounted empty and kept mounted: a live region that arrives with its
          text already in it is not reliably announced. The bar is decoration
          (`aria-hidden`); this is the status message (WCAG 2.2 SC 4.1.3), and
          it is the only feedback a reduced-motion user gets that changes over
          time — measured, the bar's animation is frozen by the blanket
          `prefers-reduced-motion` guard in globals.css. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
}
