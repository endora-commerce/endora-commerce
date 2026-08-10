import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DictionaryEntryType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../../currencies/entities/currency.entity.js';
import { Language } from '../../languages/entities/language.entity.js';
import { Country } from '../entities/country.entity.js';
import { DictionaryTranslation } from '../entities/dictionary-translation.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

export interface UpsertTranslationInput {
  entryType: DictionaryEntryType;
  entryCode: string;
  languageCode: string;
  label: string;
}

export class TranslationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly invalidateDictionaryCache?: () => Promise<void>,
    private readonly auditLog?: AuditLogService,
  ) {}

  async upsert(input: UpsertTranslationInput): Promise<DictionaryTranslation> {
    const em = this.emFactory();
    await this.assertParentExists(em, input.entryType, input.entryCode);
    const language = await em.findOne(Language, { code: input.languageCode });
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
          ? await em.findOne(Currency, { code: entryCode })
          : await em.findOne(Language, { code: entryCode });
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
