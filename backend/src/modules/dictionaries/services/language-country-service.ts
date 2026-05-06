// LanguageCountryService — feature 017 / T028.
//
// Manages the M2M between Languages and Countries plus the at-most-one-
// primary-language-per-Country invariant. The invariant is hard-enforced
// at the database via a partial unique index
// `uniq_language_countries_primary_per_country` (see migration
// `038_dictionary_init.ts`); this service implements the transactional
// promote+demote pattern so set-primary operations never violate the
// index mid-flight.

import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { LanguageCountry } from '../entities/language-country.entity.js';
import { Language } from '../../languages/entities/language.entity.js';
import { Country } from '../entities/country.entity.js';

export class LanguageCountryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly invalidateDictionaryCache?: () => Promise<void>,
  ) {}

  async listForLanguage(languageCode: string): Promise<LanguageCountry[]> {
    const em = this.emFactory();
    return em.find(LanguageCountry, { languageCode });
  }

  async listForCountry(countryCode: string): Promise<LanguageCountry[]> {
    const em = this.emFactory();
    return em.find(LanguageCountry, { countryCode });
  }

  async upsert(input: {
    languageCode: string;
    countryCode: string;
    isPrimary?: boolean;
  }): Promise<LanguageCountry> {
    const em = this.emFactory();
    // Validate parent rows exist — the FK enforces this too, but a clear
    // error message at the service layer is more operator-friendly.
    const [lang, country] = await Promise.all([
      em.findOne(Language, { code: input.languageCode }),
      em.findOne(Country, { code: input.countryCode }),
    ]);
    if (!lang) {
      throw new HttpError(
        404,
        ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
        `Language ${input.languageCode} not found.`,
      );
    }
    if (!country) {
      throw new HttpError(
        404,
        ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
        `Country ${input.countryCode} not found.`,
      );
    }

    const wantsPrimary = input.isPrimary === true;

    // Promote-with-demote inside the EM's current tx scope (no inner
    // transactional — see CountryService.setDefault for rationale).
    if (wantsPrimary) {
      await em.nativeUpdate(
        LanguageCountry,
        {
          countryCode: input.countryCode,
          isPrimary: true,
          languageCode: { $ne: input.languageCode },
        },
        { isPrimary: false },
      );
    }

    const existing = await em.findOne(LanguageCountry, {
      languageCode: input.languageCode,
      countryCode: input.countryCode,
    });
    if (existing) {
      if (input.isPrimary !== undefined) existing.isPrimary = wantsPrimary;
      await em.flush();
      await this.invalidateDictionaryCache?.();
      return existing;
    }
    const row = em.create(LanguageCountry, {
      languageCode: input.languageCode,
      countryCode: input.countryCode,
      ...(input.isPrimary !== undefined ? { isPrimary: wantsPrimary } : {}),
    });
    await em.persistAndFlush(row);
    await this.invalidateDictionaryCache?.();
    return row;
  }

  async remove(languageCode: string, countryCode: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(LanguageCountry, { languageCode, countryCode });
    if (!row) return;
    await em.removeAndFlush(row);
    await this.invalidateDictionaryCache?.();
  }
}
