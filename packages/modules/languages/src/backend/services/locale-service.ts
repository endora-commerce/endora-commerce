import type { LanguageService } from './language-service.js';

/**
 * LocaleService — the small chunk of behaviour FR-105 calls
 * "translation-fallback middleware".
 *
 * `pickLocalizedValue(record, requestedLocale, defaultLocale?)` — given a
 * `Record<localeCode, string>` (the multilingual JSONB shape used by
 * Product / Category / CMS), return the best available string. Order:
 * requested → default → first present → empty string.
 *
 * It does not read `Accept-Language` (issue #1011): a request's content
 * language is `requestScopeLanguage` (`@endora-commerce/contracts`) against its
 * sales channel, and its message language is `request.responseLanguage()`.
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
}
