/**
 * Web app manifest (feature 046 / FR-001..FR-003, FR-011).
 *
 * Served as a Next.js Route Handler so the manifest reflects the admin-configured,
 * per-Sales-Channel PWA identity (name, short name, theme/background color, icons,
 * display mode) resolved from the backend at request time. Falls back to platform
 * defaults when the backend is unreachable so the manifest is always valid
 * (graceful degradation — US1 scenario 3).
 */

import { fetchPwaConfig } from '../../lib/api/pwa-server';
import { CATALOGUE_LOCALES, tForLocale } from '../../lib/i18n/messages';
import { resolveLocaleWithoutConfig } from '../../lib/i18n/locale';
import { LANGUAGE_REQUEST_HEADER } from '../../lib/i18n/locale-path';
import { FALLBACK_LOCALE } from '../../lib/i18n/document-locale';

export const dynamic = 'force-dynamic';

/**
 * The manifest's language (issue #85), from the request alone: the browser
 * fetches `/manifest.webmanifest` without a language prefix, so the path
 * language the middleware forwards is there only when it could tell, and the
 * browser's `Accept-Language` decides otherwise — as the outage notice does.
 */
function manifestLocale(request: Request | undefined): string {
  const pathLanguage = request?.headers.get(LANGUAGE_REQUEST_HEADER);
  const acceptLanguage = request?.headers.get('accept-language');
  return resolveLocaleWithoutConfig({
    acceptLanguage: [pathLanguage, acceptLanguage].filter((v): v is string => Boolean(v)).join(',') || null,
    available: CATALOGUE_LOCALES,
    fallback: FALLBACK_LOCALE,
  });
}

export async function GET(request?: Request): Promise<Response> {
  const channelCode = request?.headers.get('x-sales-channel') ?? undefined;
  const config = await fetchPwaConfig(channelCode);
  const t = tForLocale(manifestLocale(request));

  const manifest = {
    name: config.appName,
    short_name: config.shortName,
    description: t('chrome.manifest.description'),
    start_url: '/',
    scope: '/',
    display: config.displayMode,
    background_color: config.backgroundColor,
    theme_color: config.themeColor,
    icons: config.icons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      ...(icon.purpose ? { purpose: icon.purpose } : {}),
    })),
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
