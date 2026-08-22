// CountryService — feature 017 / T025.
//
// Owns the platform-wide Country registry. Same invariants as the legacy
// LanguageService / CurrencyService (default rotation, at-least-one-active,
// default-cannot-be-deactivated, immutable code on update) plus FK
// protection on hard-delete that scans every consumer table named in
// data-model.md (addresses, taxes, warehouses, organizations registered
// address JSONB) — through `countryReferenceRegistry` since feature 077's D-87
// drain, where the scan used to be raw SQL naming those four tables directly.

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type DictionaryReference,
  type DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Country } from '../entities/country.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

export interface CreateCountryInput {
  code: string;
  alpha3Code: string;
  numericCode: string;
  label: string;
  region: 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania' | 'Antarctic';
  subregion?: string | null;
  dialCode?: string | null;
  isEuMember?: boolean;
  defaultCurrencyCode?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateCountryInput {
  alpha3Code?: string;
  numericCode?: string;
  label?: string;
  region?: 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania' | 'Antarctic';
  subregion?: string | null;
  dialCode?: string | null;
  isEuMember?: boolean;
  defaultCurrencyCode?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export class CountryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly invalidateDictionaryCache?: () => Promise<void>,
    private readonly auditLog?: AuditPort,
    /**
     * Resolved per call rather than captured: the registry is a singleton this
     * module owns, but the accessor keeps the constructor honest for the tests
     * that build the service without one.
     */
    private readonly referenceRegistry?: () => DictionaryReferenceRegistryPort,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'country',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  async list(): Promise<Country[]> {
    const em = this.emFactory();
    return em.find(Country, {}, { orderBy: { sortOrder: 'asc', label: 'asc' } });
  }

  async listActive(): Promise<Country[]> {
    const em = this.emFactory();
    return em.find(
      Country,
      { isActive: true },
      { orderBy: { sortOrder: 'asc', label: 'asc' } },
    );
  }

  async getDefault(): Promise<Country | null> {
    const em = this.emFactory();
    return em.findOne(Country, { isDefault: true });
  }

  async getByCode(code: string): Promise<Country | null> {
    const em = this.emFactory();
    return em.findOne(Country, { code });
  }

  async create(input: CreateCountryInput): Promise<Country> {
    const em = this.emFactory();
    const existing = await em.findOne(Country, { code: input.code });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Country ${input.code} already exists.`,
      );
    }
    const row = em.create(Country, {
      code: input.code,
      alpha3Code: input.alpha3Code,
      numericCode: input.numericCode,
      label: input.label,
      region: input.region,
      ...(input.subregion !== undefined ? { subregion: input.subregion } : {}),
      ...(input.dialCode !== undefined ? { dialCode: input.dialCode } : {}),
      ...(input.isEuMember !== undefined ? { isEuMember: input.isEuMember } : {}),
      ...(input.defaultCurrencyCode !== undefined
        ? { defaultCurrencyCode: input.defaultCurrencyCode }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    em.persist(row);
    this.#audit(em, 'country.create', row.code, null, { label: row.label });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  async update(code: string, input: UpdateCountryInput): Promise<Country> {
    const em = this.emFactory();
    const existing = await em.findOne(Country, { code });
    if (!existing) {
      throw new HttpError(404, ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND, `Country ${code} not found.`);
    }

    // Default-cannot-be-deactivated invariant.
    if (input.isActive === false && existing.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot deactivate the default country. Promote a different country first.',
      );
    }

    // At-least-one-active invariant — guard the deactivation path.
    if (input.isActive === false && existing.isActive) {
      const otherActive = await em.count(Country, { isActive: true, code: { $ne: code } });
      if (otherActive === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_LAST_ACTIVE_ENTRY,
          'At least one country must remain active.',
        );
      }
    }

    if (input.alpha3Code !== undefined) existing.alpha3Code = input.alpha3Code;
    if (input.numericCode !== undefined) existing.numericCode = input.numericCode;
    if (input.label !== undefined) existing.label = input.label;
    if (input.region !== undefined) existing.region = input.region;
    if (input.subregion !== undefined) existing.subregion = input.subregion;
    if (input.dialCode !== undefined) existing.dialCode = input.dialCode;
    if (input.isEuMember !== undefined) existing.isEuMember = input.isEuMember;
    if (input.defaultCurrencyCode !== undefined) {
      existing.defaultCurrencyCode = input.defaultCurrencyCode;
    }
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;

    this.#audit(em, 'country.update', existing.code, null, { label: existing.label, isActive: existing.isActive });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return existing;
  }

  async setDefault(code: string): Promise<Country> {
    const em = this.emFactory();
    const target = await em.findOne(Country, { code });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND, `Country ${code} not found.`);
    }
    if (!target.isActive) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot mark an inactive country as default.',
      );
    }
    if (target.isDefault) return target;

    // Demote-then-promote in two steps inside the EM's current scope
    // (or its own implicit tx if not already in one). em.nativeUpdate is
    // tx-aware — it honours an outer transaction when one is open.
    await em.nativeUpdate(Country, { isDefault: true }, { isDefault: false });
    await em.nativeUpdate(Country, { code }, { isDefault: true });
    target.isDefault = true;
    this.#audit(em, 'country.set_default', code, null, { isDefault: true });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return target;
  }

  /**
   * Every consumer reference to `code` (feature 077, D-87).
   *
   * Three hand-written `count(*)` statements over `addresses`, `taxes` and
   * `organizations` used to live here, and a comment explaining that
   * `warehouses` was skipped because its country sits inside a JSONB column and
   * "covering that path requires a separate scan that v1 defers". The scan is
   * `inventory`'s to write and it writes it: the descriptor it contributes
   * answers the same question about its own table, so the gap closed as a side
   * effect of moving the question to the module that can answer it.
   */
  async countDependents(code: string): Promise<DictionaryReference[]> {
    const registry = this.referenceRegistry?.();
    return registry ? registry.countReferences(code) : [];
  }

  async remove(code: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Country, { code });
    if (!row) {
      throw new HttpError(
        404,
        ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
        `Country ${code} not found.`,
      );
    }
    if (row.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot delete the default country. Promote a different country first.',
      );
    }
    const dependents = await this.countDependents(code);
    // Which references refuse the delete is the contributing module's call,
    // carried on the descriptor.
    const total = dependents
      .filter((reference) => reference.blocking)
      .reduce((sum, reference) => sum + reference.count, 0);
    if (total > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_ENTRY_HAS_DEPENDENTS,
        `Country ${code} cannot be deleted because ${total} consumer reference(s) exist.`,
        [
          {
            path: 'consumers',
            issue: JSON.stringify(dependents),
          },
        ],
      );
    }
    this.#audit(em, 'country.delete', row.code, { label: row.label }, null);
    await em.removeAndFlush(row);
    await this.invalidateDictionaryCache?.();
  }
}
