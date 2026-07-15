'use client';

import { trackGaEvent } from './gtag';

/**
 * GA4 **Enhanced Measurement** replicated for pure server-side mode (feature
 * 049). In client mode gtag.js emits these automatically; in server-side mode
 * gtag.js is not loaded, so we detect the same interactions in the browser and
 * route them through the platform server (`trackGaEvent` → /collect → MP).
 *
 * Installed only when `serverSide` is on (by AnalyticsProvider). Covers:
 * `scroll` (90% depth), outbound `click`, `file_download`, `form_start`,
 * `form_submit`. Site search (`view_search_results`) is emitted per navigation
 * by the page-view tracker. Video engagement is not covered (it needs the
 * YouTube iframe API and would require a client-side player integration).
 */

const SEARCH_PARAM_KEYS = ['q', 's', 'search', 'query', 'keyword'];
const FILE_EXT_RE =
  /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|gz|tar|txt|csv|rtf|mp3|wav|mp4|mov|avi|wmv|mkv|dmg|pkg|exe|apk|iso)(?:$|\?)/i;

function linkText(a: Element): string {
  return (a.textContent ?? '').trim().slice(0, 100);
}

export function installEnhancedMeasurement(): () => void {
  const cleanups: Array<() => void> = [];

  // --- scroll: fire once per page at 90% depth (reset on SPA navigation) ---
  let scrollFired = false;
  let lastPath = window.location.pathname;
  const onScroll = (): void => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      scrollFired = false;
    }
    if (scrollFired) return;
    const el = document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    if (window.scrollY / max >= 0.9) {
      scrollFired = true;
      trackGaEvent('scroll', { percent_scrolled: 90 });
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => window.removeEventListener('scroll', onScroll));

  // --- outbound clicks + file downloads (single delegated listener) ---
  const onClick = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement | null)?.closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    const ext = url.pathname.match(FILE_EXT_RE)?.[1];
    if (ext) {
      trackGaEvent('file_download', {
        file_name: decodeURIComponent(url.pathname.split('/').pop() ?? url.pathname),
        file_extension: ext.toLowerCase(),
        link_url: url.href,
        link_text: linkText(a),
      });
    }
    if (url.host && url.host !== window.location.host) {
      trackGaEvent('click', {
        link_url: url.href,
        link_domain: url.host,
        link_text: linkText(a),
        outbound: true,
      });
    }
  };
  document.addEventListener('click', onClick, { capture: true });
  cleanups.push(() => document.removeEventListener('click', onClick, { capture: true }));

  // --- form_start (first interaction) + form_submit ---
  const started = new WeakSet<HTMLFormElement>();
  const onInput = (e: Event): void => {
    const form = (e.target as HTMLElement | null)?.closest?.('form');
    if (!form || started.has(form)) return;
    started.add(form);
    trackGaEvent('form_start', formParams(form));
  };
  const onSubmit = (e: Event): void => {
    const form = e.target as HTMLElement | null;
    if (!form || form.tagName !== 'FORM') return;
    trackGaEvent('form_submit', formParams(form as HTMLFormElement));
  };
  document.addEventListener('input', onInput, { capture: true });
  document.addEventListener('submit', onSubmit, { capture: true });
  cleanups.push(() => document.removeEventListener('input', onInput, { capture: true }));
  cleanups.push(() => document.removeEventListener('submit', onSubmit, { capture: true }));

  return () => {
    for (const fn of cleanups) fn();
  };
}

function formParams(form: HTMLFormElement): Record<string, string> {
  return {
    form_id: form.id || '',
    form_name: form.getAttribute('name') || '',
    form_destination: form.action || '',
  };
}

/** Emit `view_search_results` when a navigation URL carries a search query. */
export function trackSiteSearch(search: string): void {
  const params = new URLSearchParams(search);
  for (const key of SEARCH_PARAM_KEYS) {
    const term = params.get(key);
    if (term) {
      trackGaEvent('view_search_results', { search_term: term });
      return;
    }
  }
}
