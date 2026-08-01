import type { ReactNode } from 'react';
import Script from 'next/script';
import { gtmContainerIdSchema, type GtmStorefrontConfig } from '@b2b/contracts';

/**
 * Injects the sales channel's Google Tag Manager container (feature 066, US1).
 * Renders nothing for an untracked channel, and nothing for a stored container
 * id that does not have the `GTM-…` shape — a typo must never reach a
 * `<script src>` (FR-005).
 *
 * Everything happens in **one** `afterInteractive` script, in this order:
 *   1. `window.dataLayer` exists before anything touches it;
 *   2. the standard `gtag` shim, published as `window.gtag` — the seam the
 *      storefront's shared `updateAnalyticsConsent()` uses to deliver the
 *      visitor's decision to the container as a proper `arguments` push, and
 *      the reason this works even with the Google Analytics module off;
 *   3. the Consent Mode v2 defaults — denied for all four signals when the
 *      channel requires consent, granted otherwise (FR-013);
 *   4. the container loader.
 *
 * The ordering is why it is one script and not two: the defaults must execute
 * before the container loads, or a Google tag inside it could fire under no
 * declared consent state at all.
 *
 * The container itself is **not** withheld pending consent (research §R16). A
 * container is not a tag: withholding it would silently disable every tag the
 * operator built, including ones that never needed consent. Consent is
 * enforced two ways instead — Consent Mode defaults for the operator's Google
 * tags, and the platform's own gate in `pushGtmEvent` for the events this
 * storefront emits. A server component cannot read the visitor's decision
 * anyway; the client-side `gtag('consent','update',…)` does that.
 */
export function GoogleTagManager({ config }: { config: GtmStorefrontConfig }): ReactNode {
  if (!config.enabled || !config.containerId) return null;
  const parsed = gtmContainerIdSchema.safeParse(config.containerId);
  if (!parsed.success) return null;
  const id = parsed.data;
  const consent = config.requireConsent ? 'denied' : 'granted';

  const init = [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    'window.gtag = window.gtag || gtag;',
    `gtag('consent','default',{analytics_storage:'${consent}',ad_storage:'${consent}',ad_user_data:'${consent}',ad_personalization:'${consent}'});`,
    `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`,
  ].join('');

  return (
    <>
      {/* Generated init — the container id is validated above, not user input. */}
      <Script id="gtm-init" strategy="afterInteractive">
        {init}
      </Script>
      {/* Standard no-JavaScript fallback so the container is still reachable
          for visitors without JavaScript (FR-017). */}
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(id)}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
