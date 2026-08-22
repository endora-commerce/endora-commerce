'use client';

import { useEffect, type ReactNode } from 'react';
import type { GtmStorefrontConfig } from '@endora-commerce/contracts';
import { configureGtm } from '../../lib/analytics/gtm/dataLayer';
import { subscribeConsent } from '../../lib/analytics/consent';

/**
 * Client-side Google Tag Manager bootstrap (feature 066, US1). Publishes the
 * resolved per-channel config to the `dataLayer` emitter, and re-publishes it
 * whenever the visitor's consent decision changes so a mid-session grant
 * unblocks the platform's own events without a reload.
 *
 * The Consent Mode `update` itself is pushed by the shared
 * `updateAnalyticsConsent()` through `window.gtag`, which <GoogleTagManager/>
 * defines — this component deliberately does not duplicate it.
 *
 * Renders no visible UI.
 */
export function GtmProvider({ config }: { config: GtmStorefrontConfig }): ReactNode {
  // Publish synchronously on first render so an interaction that fires before
  // effects run still sees the config.
  configureGtm(config);

  useEffect(() => {
    configureGtm(config);
    return subscribeConsent(() => configureGtm(config));
  }, [config]);

  return null;
}
