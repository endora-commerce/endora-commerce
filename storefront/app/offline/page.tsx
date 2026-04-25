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

export const metadata = {
  title: 'Offline',
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
