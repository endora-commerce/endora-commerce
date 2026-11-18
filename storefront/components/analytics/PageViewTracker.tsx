'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { getGaConfig, sendPageView } from '../../lib/analytics/gtag';
import { trackSiteSearch } from '../../lib/analytics/enhancedMeasurement';
import { sendGtmPageView, sendGtmSearchResults } from '../../lib/analytics/gtm/dataLayer';
import { isSecretBearingPath, redactSecretPath } from '../../lib/analytics/secret-paths';

/**
 * Emits a GA4 `page_view` on every App-Router navigation (feature 049, US1),
 * and the Google Tag Manager `page_view` / `view_search_results` alongside it
 * (feature 066, US2).
 *
 * GA4's automatic page-view only fires on a full document load, so in-app
 * navigations would be missed. We disable it (`send_page_view: false`) and fire
 * manually here on each `pathname`/`searchParams` change — exactly one view per
 * destination (FR-008 / FR-019). A ref guards against firing twice for the same
 * resolved URL (e.g. React strict-mode double effects), and it guards both
 * platforms, so GTM inherits the same exactly-once guarantee.
 */
export function PageViewTracker(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    // 181 design review F-2 — a guest token in the path or the query is never reported:
    // the tracking and verification pages report their redacted path and no query.
    const secret = isSecretBearingPath(pathname);
    const query = secret ? '' : searchParams?.toString();
    const url = secret ? redactSecretPath(pathname ?? '') : query ? `${pathname}?${query}` : pathname;
    if (url === lastUrl.current) return;
    lastUrl.current = url;
    sendPageView(url);
    // Enhanced Measurement site search is only replicated in server-side mode
    // (gtag emits view_search_results itself in client mode).
    if (query && getGaConfig()?.serverSide) trackSiteSearch(query);
    // GTM has no automatic page view at all: the container's built-in History
    // Change trigger is the operator's to configure, and the docs steer them to
    // this custom event instead so a navigation is not counted twice.
    sendGtmPageView(url);
    if (query) sendGtmSearchResults(query);
  }, [pathname, searchParams]);

  return null;
}
