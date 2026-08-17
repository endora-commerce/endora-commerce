import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  type CurrencyReadPort,
  type DictionaryEntryType,
  type DictionaryValidator as DictionaryValidatorPort,
  type DictionaryWriteMode,
  type LanguageReadPort,
} from '@b2b/contracts';
import { Country } from '../entities/country.entity.js';

interface CacheEntry {
  exists: boolean;
  isActive: boolean;
  expiresAt: number;
}

const TTL_MS = 60_000;

export class DictionaryValidator implements DictionaryValidatorPort {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Feature 075, Phase C — `country` is this module's own table and stays an
   * `em.findOne`; `currency` and `language` are not, and go through their
   * owners' read ports. The reads used to be `em.findOne(Currency, …)` /
   * `em.findOne(Language, …)` against tables deactivation does not drop, so a
   * write validated against a switched-off `currencies` was accepted as valid.
   * Fail-closed is the right answer for a validator: an unvalidated code
   * written into an order or a tax rule is worse than a refused write, and both
   * owners are binding `dependencies` of this manifest.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly currencies: CurrencyReadPort,
    private readonly languages: LanguageReadPort,
  ) {}

  async validateCountryCode(code: string, mode: DictionaryWriteMode): Promise<void> {
    await this.validate('country', code.toUpperCase(), mode);
  }

  async validateCurrencyCode(code: string, mode: DictionaryWriteMode): Promise<void> {
    await this.validate('currency', code.toUpperCase(), mode);
  }

  async validateLanguageCode(code: string, mode: DictionaryWriteMode): Promise<void> {
    await this.validate('language', code, mode);
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async validate(
    entryType: DictionaryEntryType,
    entryCode: string,
    mode: DictionaryWriteMode,
  ): Promise<void> {
    const state = await this.getState(entryType, entryCode);
    if (!state.exists) {
      throw new DictionaryReferenceError({
        code: 'DICTIONARY_ENTRY_NOT_FOUND',
        entryType,
        entryCode,
      });
    }
    if (mode === 'create-or-change' && !state.isActive) {
      throw new DictionaryReferenceError({
        code: 'DICTIONARY_ENTRY_INACTIVE',
        entryType,
        entryCode,
      });
    }
  }

  private async getState(entryType: DictionaryEntryType, entryCode: string): Promise<CacheEntry> {
    const key = `${entryType}:${entryCode}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const row =
      entryType === 'country'
        ? await this.emFactory().findOne(Country, { code: entryCode })
        : entryType === 'currency'
          ? await this.currencies.findByCode(entryCode)
          : await this.languages.findByCode(entryCode);
    const next: CacheEntry = {
      exists: Boolean(row),
      isActive: row?.isActive ?? false,
      expiresAt: Date.now() + TTL_MS,
    };
    this.cache.set(key, next);
    return next;
  }
}
