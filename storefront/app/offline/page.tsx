import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Offline fallback (T236 / FR-104). Pre-cached by the service worker on
 * install so it's available the very first time the user goes offline.
 *
 * Kept intentionally minimal — depending on cached assets here would
 * defeat the purpose. Themes typically restyle but should keep the SSR /
 * no-script-required posture.
 */
export const dynamic = 'force-static';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): a PWA
 * fallback that exists to be served *instead of* a page, so a crawler that
 * indexed it would rank the shop for its own failure state.
 */
export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};

export default function OfflinePage(): ReactNode {
  return (
    <section>
      <h1>You are offline</h1>
      <p>
        Showing the last version of this page that you visited. Re-connect to
        the internet to load the latest catalog data, place an order, or
        request a quote.
      </p>
    </section>
  );
}
