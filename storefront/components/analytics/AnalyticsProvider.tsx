'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import type { GaStorefrontConfig } from '@endora-commerce/contracts';
import { configureGa } from '../../lib/analytics/gtag';
import { emitButtonClick } from '../../lib/analytics/collector';
import { installEnhancedMeasurement } from '../../lib/analytics/enhancedMeasurement';
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

    const cleanups: Array<() => void> = [];

    // Delegated listener for the button_click_by_id custom-event trigger.
    if (config.customEvents.some((e) => e.triggerAction === 'button_click_by_id')) {
      const onClick = (ev: MouseEvent): void => {
        const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[id],[data-ga-event]');
        if (el) emitButtonClick(el, window.location.pathname);
      };
      document.addEventListener('click', onClick, { capture: true });
      cleanups.push(() => document.removeEventListener('click', onClick, { capture: true }));
    }

    // GA4 Enhanced Measurement replicated for pure server-side mode (in client
    // mode gtag.js emits these automatically).
    if (config.serverSide) {
      cleanups.push(installEnhancedMeasurement());
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  }, [config]);

  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
