'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { sendPageView } from '../../lib/analytics/gtag';

/**
 * Emits a GA4 `page_view` on every App-Router navigation (feature 049, US1).
 *
 * GA4's automatic page-view only fires on a full document load, so in-app
 * navigations would be missed. We disable it (`send_page_view: false`) and fire
 * manually here on each `pathname`/`searchParams` change — exactly one view per
 * destination (FR-008). A ref guards against firing twice for the same resolved
 * URL (e.g. React strict-mode double effects).
 */
export function PageViewTracker(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    if (url === lastUrl.current) return;
    lastUrl.current = url;
    sendPageView(url);
  }, [pathname, searchParams]);

  return null;
}
