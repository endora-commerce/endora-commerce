import type { LanguageService } from './language-service.js';

/**
 * LocaleService — the small chunk of behaviour FR-105 calls
 * "translation-fallback middleware".
 *
 * Two responsibilities:
 *   1. `pickLocalizedValue(record, requestedLocale, defaultLocale?)` — given a
 *      `Record<localeCode, string>` (the multilingual JSONB shape used by
 *      Product / Category / CMS), return the best available string. Order:
 *      requested → default → first present → empty string.
 *   2. `resolveRequestLocale(acceptLanguageHeader)` — pick a supported
 *      locale for the current request, with the admin-configured default
 *      as the last-resort fallback.
 *
 * The default locale is read once per resolver and cached for the lifetime
 * of the service instance to avoid hitting the DB on every request; it is
 * refreshed on `invalidateDefault()` after admin mutations.
 */
export class LocaleService {
  private cachedDefaultCode: string | null = null;
  private cachedDefaultLoadedAt = 0;
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly languageService: LanguageService) {}

  pickLocalizedValue(
    record: Record<string, string> | null | undefined,
    requestedLocale: string,
    defaultLocale?: string,
  ): string {
    if (!record) return '';
    if (record[requestedLocale]) return record[requestedLocale];
    if (defaultLocale && record[defaultLocale]) return record[defaultLocale];
    const values = Object.values(record);
    return values[0] ?? '';
  }

  async getDefaultLocale(): Promise<string> {
    const now = Date.now();
    if (this.cachedDefaultCode && now - this.cachedDefaultLoadedAt < this.cacheTtlMs) {
      return this.cachedDefaultCode;
    }
    const row = await this.languageService.getDefault();
    this.cachedDefaultCode = row?.code ?? 'en-US';
    this.cachedDefaultLoadedAt = now;
    return this.cachedDefaultCode;
  }

  invalidateDefault(): void {
    this.cachedDefaultLoadedAt = 0;
    this.cachedDefaultCode = null;
  }

  /**
   * Resolve a single locale string from an Accept-Language header against
   * the active language pool. Returns the configured default when nothing
   * matches.
   */
  async resolveRequestLocale(
    acceptLanguageHeader: string | undefined,
    activeLocales: string[],
  ): Promise<string> {
    const def = await this.getDefaultLocale();
    if (!acceptLanguageHeader) return def;

    const candidates = parseAcceptLanguage(acceptLanguageHeader);
    for (const cand of candidates) {
      const exact = activeLocales.find((l) => l.toLowerCase() === cand.toLowerCase());
      if (exact) return exact;
      // Fall back to the language part only ("en" matches "en-US").
      const langOnly = cand.split('-')[0]!.toLowerCase();
      const broad = activeLocales.find(
        (l) => l.split('-')[0]!.toLowerCase() === langOnly,
      );
      if (broad) return broad;
    }
    return def;
  }
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
