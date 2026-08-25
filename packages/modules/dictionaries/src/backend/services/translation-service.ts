import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CurrencyReadPort,
  type DictionaryEntryType,
  type LanguageReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Country } from '../entities/country.entity.js';
import { DictionaryTranslation } from '../entities/dictionary-translation.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

export interface UpsertTranslationInput {
  entryType: DictionaryEntryType;
  entryCode: string;
  languageCode: string;
  label: string;
}

export class TranslationService {
  /**
   * Feature 075, Phase C — a translation's parent may be a country (this
   * module's row), a currency or a language (not). The two that are not are
   * read through their owners' ports, so a translation cannot be attached to a
   * parent the platform is no longer serving.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly currencies: CurrencyReadPort,
    private readonly languages: LanguageReadPort,
    private readonly invalidateDictionaryCache?: () => Promise<void>,
    private readonly auditLog?: AuditPort,
  ) {}

  async upsert(input: UpsertTranslationInput): Promise<DictionaryTranslation> {
    const em = this.emFactory();
    await this.assertParentExists(em, input.entryType, input.entryCode);
    const language = await this.languages.findByCode(input.languageCode);
    if (!language) throw notFound('language', input.languageCode);
    if (!language.isActive) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_ENTRY_INACTIVE,
        `Language ${input.languageCode} is inactive.`,
      );
    }

    let row = await em.findOne(DictionaryTranslation, {
      entryType: input.entryType,
      entryCode: input.entryCode,
      languageCode: input.languageCode,
    });
    if (!row) {
      row = em.create(DictionaryTranslation, {
        entryType: input.entryType,
        entryCode: input.entryCode,
        languageCode: input.languageCode,
        label: input.label,
      });
      em.persist(row);
    } else {
      row.label = input.label;
    }
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'dictionary_translation.upsert',
        objectType: 'dictionary_translation',
        objectId: `${input.entryType}:${input.entryCode}:${input.languageCode}`,
        stateBefore: null,
        stateAfter: { label: input.label },
      });
    }
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  async remove(
    entryType: DictionaryEntryType,
    entryCode: string,
    languageCode: string,
  ): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(DictionaryTranslation, { entryType, entryCode, languageCode });
    if (!row) throw notFound(entryType, entryCode);
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'dictionary_translation.delete',
        objectType: 'dictionary_translation',
        objectId: `${entryType}:${entryCode}:${languageCode}`,
        stateBefore: { label: row.label },
        stateAfter: null,
      });
    }
    await em.removeAndFlush(row);
    await this.invalidateDictionaryCache?.();
  }

  async listForEntry(
    entryType: DictionaryEntryType,
    entryCode: string,
  ): Promise<DictionaryTranslation[]> {
    const em = this.emFactory();
    await this.assertParentExists(em, entryType, entryCode);
    return em.find(DictionaryTranslation, { entryType, entryCode }, { orderBy: { languageCode: 'asc' } });
  }

  private async assertParentExists(
    em: EntityManager,
    entryType: DictionaryEntryType,
    entryCode: string,
  ): Promise<void> {
    const exists =
      entryType === 'country'
        ? await em.findOne(Country, { code: entryCode })
        : entryType === 'currency'
          ? await this.currencies.findByCode(entryCode)
          : await this.languages.findByCode(entryCode);
    if (!exists) throw notFound(entryType, entryCode);
  }
}

function notFound(entryType: DictionaryEntryType, entryCode: string): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
    `Dictionary ${entryType} ${entryCode} not found.`,
  );
}
