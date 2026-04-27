import type { I18nConfigResponse } from '@b2b/contracts';

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
