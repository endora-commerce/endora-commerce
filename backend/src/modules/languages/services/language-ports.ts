import type {
  LanguageAdminPort,
  LanguageReadPort,
  LanguageRecord,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Language } from '../entities/language.entity.js';
import type { LanguageService } from './language-service.js';

/**
 * The published face of `languages` (feature 075, Phase P).
 *
 * Sixteen inbound sites, and they split the way the module does: ten are
 * `dictionaries` reading the `Language` **entity** to resolve a label,
 * validate a code or walk a fallback chain, and six type themselves against
 * `LanguageService` to call `listActive`.
 *
 * The read port answers both, and neither hands the entity over. `findByCode`
 * is the one method with no direct predecessor: `dictionaries` looks a
 * language up by code in four places with `em.findOne(Language, { code })`,
 * which is the read this replaces.
 */
export class LanguageReadService implements LanguageReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<LanguageRecord[]> {
    const rows = await this.emFactory().find(
      Language,
      {},
      { orderBy: { sortOrder: 'asc', code: 'asc' } },
    );
    return rows.map(toLanguageRecord);
  }

  async listActive(): Promise<LanguageRecord[]> {
    const rows = await this.emFactory().find(
      Language,
      { isActive: true },
      { orderBy: { sortOrder: 'asc', code: 'asc' } },
    );
    return rows.map(toLanguageRecord);
  }

  async getDefault(): Promise<LanguageRecord | null> {
    const row = await this.emFactory().findOne(Language, { isDefault: true });
    return row ? toLanguageRecord(row) : null;
  }

  async findByCode(code: string): Promise<LanguageRecord | null> {
    const row = await this.emFactory().findOne(Language, { code });
    return row ? toLanguageRecord(row) : null;
  }
}

/**
 * The write side, adapting `LanguageService`. The service arrives as a getter
 * so the adapter resolves it per call rather than capturing this module's own
 * gated port into a singleton.
 */
export function createLanguageAdminPort(getService: () => LanguageService): LanguageAdminPort {
  return {
    async create(input) {
      return toLanguageRecord(await getService().create(input));
    },
    async update(code, input) {
      return toLanguageRecord(await getService().update(code, input));
    },
    async setDefault(code) {
      return toLanguageRecord(await getService().setDefault(code));
    },
    remove: (code) => getService().remove(code),
  };
}

export function toLanguageRecord(language: Language): LanguageRecord {
  return {
    code: language.code,
    label: language.label,
    nativeLabel: language.nativeLabel,
    isRtl: language.isRtl,
    fallbackCode: language.fallbackCode ?? null,
    isDefault: language.isDefault,
    isActive: language.isActive,
    sortOrder: language.sortOrder,
    createdAt: language.createdAt,
    updatedAt: language.updatedAt,
  };
}
