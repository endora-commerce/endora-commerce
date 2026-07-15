import type { ReactNode } from 'react';
import Script from 'next/script';
import type { GaStorefrontConfig } from '@b2b/contracts';

/**
 * Injects Google Analytics 4 (feature 049, US1). Renders nothing for untracked
 * channels. Loads `gtag.js` with `afterInteractive` so it never blocks the
 * critical path (Principle VII / Core Web Vitals) and initializes GA4 with:
 *   - Consent Mode v2 default state (denied until granted when `requireConsent`),
 *   - `send_page_view: false` so page views are emitted manually per
 *     App-Router navigation (<PageViewTracker/>), giving exactly one view per
 *     destination.
 */
export function GoogleAnalytics({ config }: { config: GaStorefrontConfig }): ReactNode {
  if (!config.enabled || !config.measurementId) return null;
  const id = config.measurementId;
  const consent = config.requireConsent ? 'denied' : 'granted';

  const init = [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js', new Date());",
    `gtag('consent','default',{analytics_storage:'${consent}',ad_storage:'${consent}',ad_user_data:'${consent}',ad_personalization:'${consent}'});`,
    `gtag('config','${id}',{send_page_view:false});`,
  ].join('');

  return (
    <>
      <Script
        id="ga-gtag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      />
      {/* Generated init — not user input. */}
      <Script id="ga-gtag-init" strategy="afterInteractive">
        {init}
      </Script>
    </>
  );
}
