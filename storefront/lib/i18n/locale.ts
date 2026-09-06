import type { I18nConfigResponse } from '@endora-commerce/contracts';

/**
 * Resolve the storefront locale for a server-rendered request.
 *
 * Priority:
 *   1. explicit `?lang=` query parameter (a language switcher writes this).
 *   2. `Accept-Language` header — q-weighted; first active match wins.
 *   3. configured default from `i18n/config`.
 *   4. hard-coded `en-US` if the API call failed.
 */
export function resolveLocale(input: {
  acceptLanguage?: string | null;
  langQuery?: string | null;
  config: I18nConfigResponse;
}): string {
  const active = input.config.languages.filter((l) => l.isActive).map((l) => l.code);
  const def = input.config.defaultLanguageCode ?? 'en-US';

  if (input.langQuery) {
    const exact = active.find((l) => l.toLowerCase() === input.langQuery!.toLowerCase());
    if (exact) return exact;
  }

  if (input.acceptLanguage) {
    const candidates = parseAcceptLanguage(input.acceptLanguage);
    for (const cand of candidates) {
      const exact = active.find((l) => l.toLowerCase() === cand.toLowerCase());
      if (exact) return exact;
      const langOnly = cand.split('-')[0]!.toLowerCase();
      const broad = active.find((l) => l.split('-')[0]!.toLowerCase() === langOnly);
      if (broad) return broad;
    }
  }

  return def;
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
 * `pl-PL,pl;q=0.9,en;q=0.8` all reach the Polish catalogue.
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

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      return { tag: tag!.trim(), q: q ? Number(q) : 1 };
    })
    .filter((c) => c.tag && !Number.isNaN(c.q))
    .sort((a, b) => b.q - a.q)
    .map((c) => c.tag);
}
