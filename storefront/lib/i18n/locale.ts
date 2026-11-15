import { parseAcceptLanguage, type I18nConfigResponse } from '@endora-commerce/contracts';

/**
 * The language a page renders in (feature 167, `specs/167-storefront-locale-path/`):
 * the path's, as the middleware forwarded it, when it is one of the **channel's**
 * languages (FR-005 — the platform-wide active list is not consulted); else the
 * channel's default language; else, when the channel could not be read, the
 * configured default from `i18n/config`; else `en-US`.
 *
 * The `lang` cookie and `Accept-Language` take no part (OR-4): the path decides.
 */
export function resolvePageLocale(input: {
  pathLanguage: string | null | undefined;
  channelLanguages: readonly string[];
  channelDefault: string | null | undefined;
  config: I18nConfigResponse;
}): string {
  if (input.pathLanguage) {
    const wanted = input.pathLanguage.toLowerCase();
    const hit = input.channelLanguages.find((l) => l.toLowerCase() === wanted);
    if (hit) return hit;
  }
  return input.channelDefault || input.config.defaultLanguageCode || 'en-US';
}

/**
 * The locale to render in when the backend cannot be asked.
 *
 * `resolveLocale` above needs `i18n/config`, which is a backend read — the very
 * read whose failure puts a request in front of the service-unavailable page.
 * So the outage notice resolves its language from the request alone, against the
 * locales the in-tree catalogue actually carries.
 *
 * Deriving rather than asking is the point (Tesler's Law): a buyer who cannot
 * reach the shop is not going to be shown a language picker, and answering an
 * outage in the wrong language is the one thing that would make it worse.
 *
 * Matching is exact first and then language-only, so `pl`, `pl-PL` and
 * `pl-PL,pl;q=0.9,en;q=0.8` all reach the Polish catalogue. The header is read by the
 * platform's one parser, `parseAcceptLanguage` (issue #1011): tags in descending `q`,
 * bounded in length and count, a tag with a malformed `q` dropped.
 */
export function resolveLocaleWithoutConfig(input: {
  acceptLanguage?: string | null;
  available: readonly string[];
  fallback: string;
}): string {
  if (input.available.length === 0) return input.fallback;
  if (input.acceptLanguage) {
    for (const candidate of parseAcceptLanguage(input.acceptLanguage)) {
      const exact = input.available.find((l) => l.toLowerCase() === candidate.toLowerCase());
      if (exact) return exact;
      const langOnly = candidate.split('-')[0]!.toLowerCase();
      const broad = input.available.find((l) => l.split('-')[0]!.toLowerCase() === langOnly);
      if (broad) return broad;
    }
  }
  return input.available.includes(input.fallback) ? input.fallback : input.available[0]!;
}

export function pickLocalizedString(
  record: Record<string, string> | null | undefined,
  locale: string,
  defaultLocale = 'en-US',
): string {
  if (!record) return '';
  if (record[locale]) return record[locale];
  if (record[defaultLocale]) return record[defaultLocale];
  return Object.values(record)[0] ?? '';
}
