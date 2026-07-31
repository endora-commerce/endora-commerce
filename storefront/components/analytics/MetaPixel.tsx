'use client';

import { useEffect } from 'react';
import type { MetaStorefrontConfig } from '@b2b/contracts';
import { subscribeConsent } from '../../lib/analytics/consent';
import { configureMeta, isMetaConfigured, loadMetaPixel } from '../../lib/analytics/meta/pixel';

/**
 * Injects the Meta Pixel for the active sales channel, behind the storefront's
 * single consent decision (feature 064, US1 + US2).
 *
 * Nothing Meta-related runs until consent is granted when the channel requires
 * it; a visitor who accepts mid-session is tracked from that moment, without a
 * reload.
 */
export function MetaPixel({ config }: { config: MetaStorefrontConfig }): null {
  useEffect(() => {
    configureMeta(config);
    if (!isMetaConfigured()) return;

    // loadMetaPixel re-checks consent itself, so both paths are safe.
    loadMetaPixel();
    return subscribeConsent(() => loadMetaPixel());
  }, [config]);

  return null;
}
