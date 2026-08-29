'use client';

import { useEffect } from 'react';
import type { LinkedInStorefrontConfig } from '@endora-commerce/contracts';
import { readConsent, subscribeConsent } from '../../lib/analytics/consent';
import { configureLinkedIn, isLinkedInConfigured, loadInsightTag } from '../../lib/analytics/linkedin/tag';

/**
 * Injects the LinkedIn Insight Tag for the active sales channel, behind the
 * storefront's single consent decision (feature 063, US1 + US2).
 *
 * Nothing LinkedIn-related runs until consent is granted when the channel
 * requires it. When the visitor grants consent mid-session the tag loads
 * immediately, without a reload.
 */
export function LinkedInInsightTag({ config }: { config: LinkedInStorefrontConfig }): null {
  useEffect(() => {
    configureLinkedIn(config);
    if (!isLinkedInConfigured()) return;

    const loadIfAllowed = (): void => {
      if (config.requireConsent && readConsent() !== 'granted') return;
      loadInsightTag();
    };

    loadIfAllowed();
    // A visitor who accepts after first paint must be tracked from that moment.
    return subscribeConsent(() => loadIfAllowed());
  }, [config]);

  return null;
}
