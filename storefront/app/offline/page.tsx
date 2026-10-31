import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerContext } from '../../lib/server-context';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Offline fallback (T236 / FR-104). Pre-cached by the service worker on
 * install so it's available the very first time the user goes offline.
 *
 * Kept intentionally minimal — depending on cached assets here would
 * defeat the purpose. Themes typically restyle but should keep the SSR /
 * no-script-required posture.
 *
 * Rendered per request, in the shop's language (issue #85): the service worker
 * fetches it while the shop is reachable, so the copy it keeps is in the
 * language the root layout stamps on `<html lang>` for the same request. It was
 * `force-static` while its copy was English-only; a static render has no
 * request to take the language from.
 */
export const dynamic = 'force-dynamic';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): a PWA
 * fallback that exists to be served *instead of* a page, so a crawler that
 * indexed it would rank the shop for its own failure state.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getServerContext();
  return {
    title: tForLocale(locale)('chrome.offline.title'),
    robots: { index: false, follow: false },
  };
}

export default async function OfflinePage(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return (
    <section>
      <h1>{t('chrome.offline.heading')}</h1>
      <p>{t('chrome.offline.body')}</p>
    </section>
  );
}
