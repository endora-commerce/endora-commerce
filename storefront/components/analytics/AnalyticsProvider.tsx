'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import type { GaStorefrontConfig } from '@b2b/contracts';
import { configureGa } from '../../lib/analytics/gtag';
import { emitButtonClick } from '../../lib/analytics/collector';
import { PageViewTracker } from './PageViewTracker';

/**
 * Client-side Google Analytics bootstrap (feature 049, US1/US3). Publishes the
 * resolved per-channel config to the gtag/collector modules, mounts the
 * page-view tracker, and installs a single delegated click listener that powers
 * the `button_click_by_id` custom-event trigger. Renders no visible UI.
 */
export function AnalyticsProvider({ config }: { config: GaStorefrontConfig }): ReactNode {
  // Publish synchronously on first render so interaction hooks that fire before
  // effects run still see the config.
  configureGa(config);

  useEffect(() => {
    configureGa(config);
    if (!config.enabled) return;
    const hasButtonEvents = config.customEvents.some(
      (e) => e.triggerAction === 'button_click_by_id',
    );
    if (!hasButtonEvents) return;
    const onClick = (ev: MouseEvent): void => {
      const target = ev.target as HTMLElement | null;
      const el = target?.closest<HTMLElement>('[id],[data-ga-event]');
      if (el) emitButtonClick(el, window.location.pathname);
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [config]);

  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
