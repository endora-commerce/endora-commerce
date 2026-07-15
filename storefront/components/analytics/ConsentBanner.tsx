'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { GaStorefrontConfig } from '@b2b/contracts';
import { updateAnalyticsConsent } from '../../lib/analytics/gtag';

const STORAGE_KEY = 'ga-consent';

/**
 * Cookie-consent banner (feature 049) driving Google Consent Mode v2. Shown only
 * when GA is enabled for the channel and `requireConsent` is on and the visitor
 * has not yet decided. A prior decision is re-applied on load so analytics
 * storage matches the saved choice without re-prompting.
 */
export function ConsentBanner({
  config,
  message,
}: {
  config: GaStorefrontConfig;
  /** Banner text — supplied from the `cookieconsent.message` CMS block. */
  message?: ReactNode;
}): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!config.enabled || !config.requireConsent) return;
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === 'granted' || saved === 'denied') {
      updateAnalyticsConsent(saved === 'granted');
      return;
    }
    setVisible(true);
  }, [config]);

  if (!visible) return null;

  function decide(granted: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, granted ? 'granted' : 'denied');
    } catch {
      // Private mode / storage disabled — apply the choice for this session only.
    }
    updateAnalyticsConsent(granted);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Zgoda na pliki cookie"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] text-muted [&_a]:underline">{message}</div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn--outline btn--sm" onClick={() => decide(false)}>
            Odrzuć
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => decide(true)}>
            Akceptuję
          </button>
        </div>
      </div>
    </div>
  );
}
