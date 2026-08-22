import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type DictionaryReference,
  type DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../entities/currency.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

/**
 * CurrencyService — admin CRUD over the currencies pool.
 *
 * Originally introduced by feature 004 (T238 / FR-105) for the minimal
 * currencies table. Extended by feature 017 to cover the new columns
 * (`symbolPosition`, `decimalPlaces`) and the spec invariants:
 *
 *   - exactly one default at a time (partial unique index, transactional
 *     promote+demote).
 *   - at-least-one-active (the only active row cannot be deactivated).
 *   - default-cannot-be-deactivated.
 *   - FK-protected hard-delete: refused while any consumer references the
 *     currency (sales channels' default_currency + currencies JSONB,
 *     promotions, price_lists).
 */
export class CurrencyService {
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
        objectType: 'currency',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  async list(): Promise<Currency[]> {
    const em = this.emFactory();
    return em.find(Currency, {}, { orderBy: { sortOrder: 'asc', code: 'asc' } });
  }

  async listActive(): Promise<Currency[]> {
    const em = this.emFactory();
    // `code` tiebreak keeps the order deterministic when several currencies
    // share a sortOrder (e.g. the seed default 0) — matches list() above.
    return em.find(Currency, { isActive: true }, { orderBy: { sortOrder: 'asc', code: 'asc' } });
  }

  async getDefault(): Promise<Currency | null> {
    const em = this.emFactory();
    return em.findOne(Currency, { isDefault: true });
  }

  async getByCode(code: string): Promise<Currency | null> {
    const em = this.emFactory();
    return em.findOne(Currency, { code });
  }

  async create(input: {
    code: string;
    label: string;
    symbol: string;
    symbolPosition?: 'prefix' | 'suffix';
    decimalPlaces?: number;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<Currency> {
    const em = this.emFactory();
    const existing = await em.findOne(Currency, { code: input.code });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Currency ${input.code} already exists.`,
      );
    }
    const row = em.create(Currency, {
      code: input.code,
      label: input.label,
      symbol: input.symbol,
      ...(input.symbolPosition !== undefined ? { symbolPosition: input.symbolPosition } : {}),
      ...(input.decimalPlaces !== undefined ? { decimalPlaces: input.decimalPlaces } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    em.persist(row);
    this.#audit(em, 'currency.create', row.code, null, { label: row.label });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  /**
   * Legacy upsert kept for `/api/v1/admin/currencies/:code` backward compat.
   * The dictionary admin surface uses `update()` for the extended fields.
   */
  async upsert(input: {
    code: string;
    label: string;
    symbol: string;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<Currency> {
    const em = this.emFactory();
    const existing = await em.findOne(Currency, { code: input.code });
    if (existing) {
      if (input.isActive === false && existing.isDefault) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
          'Cannot deactivate the default currency. Promote a different currency first.',
        );
      }
      if (input.isActive === false && existing.isActive) {
        const otherActive = await em.count(Currency, {
          isActive: true,
          code: { $ne: input.code },
        });
        if (otherActive === 0) {
          throw new HttpError(
            409,
            ERROR_CODES.DICTIONARY_LAST_ACTIVE_ENTRY,
            'At least one currency must remain active.',
          );
        }
      }
      existing.label = input.label;
      existing.symbol = input.symbol;
      if (input.isActive !== undefined) existing.isActive = input.isActive;
      if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
      this.#audit(em, 'currency.upsert', existing.code, null, { label: existing.label });
      await em.flush();
      await this.invalidateDictionaryCache?.();
      return existing;
    }
    const row = em.create(Currency, {
      code: input.code,
      label: input.label,
      symbol: input.symbol,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    em.persist(row);
    this.#audit(em, 'currency.upsert', row.code, null, { label: row.label });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  /**
   * Extended update used by the Dictionary admin surface (feature 017).
   * Supports every column on the Currency entity and enforces the spec
   * invariants.
   */
  async update(
    code: string,
    input: {
      label?: string;
      symbol?: string;
      symbolPosition?: 'prefix' | 'suffix';
      decimalPlaces?: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ): Promise<Currency> {
    const em = this.emFactory();
    const existing = await em.findOne(Currency, { code });
    if (!existing) {
      throw new HttpError(
        404,
        ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
        `Currency ${code} not found.`,
      );
    }

    if (input.isActive === false && existing.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot deactivate the default currency. Promote a different currency first.',
      );
    }
    if (input.isActive === false && existing.isActive) {
      const otherActive = await em.count(Currency, {
        isActive: true,
        code: { $ne: code },
      });
      if (otherActive === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_LAST_ACTIVE_ENTRY,
          'At least one currency must remain active.',
        );
      }
    }

    if (input.decimalPlaces !== undefined) {
      if (input.decimalPlaces < 0 || input.decimalPlaces > 6) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'decimalPlaces must be between 0 and 6.',
        );
      }
    }

    if (input.label !== undefined) existing.label = input.label;
    if (input.symbol !== undefined) existing.symbol = input.symbol;
    if (input.symbolPosition !== undefined) existing.symbolPosition = input.symbolPosition;
    if (input.decimalPlaces !== undefined) existing.decimalPlaces = input.decimalPlaces;
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;

    this.#audit(em, 'currency.update', existing.code, null, { label: existing.label, isActive: existing.isActive });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return existing;
  }

  async setDefault(code: string): Promise<Currency> {
    const em = this.emFactory();
    const target = await em.findOne(Currency, { code });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Currency ${code} not found.`);
    }
    if (!target.isActive) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot mark an inactive currency as default.',
      );
    }
    if (target.isDefault) return target;

    // Demote-then-promote inside the EM's current tx scope (see
    // LanguageService.setDefault for rationale).
    await em.nativeUpdate(Currency, { isDefault: true }, { isDefault: false });
    await em.nativeUpdate(Currency, { code }, { isDefault: true });
    target.isDefault = true;
    this.#audit(em, 'currency.set_default', code, null, { isDefault: true });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return target;
  }

  /**
   * Every consumer reference to `code`, across the platform (feature 077, D-87).
   *
   * This used to be five hand-written `count(*)` statements naming
   * `sales_channels`, `promotions`, `price_lists` and `countries` — four tables
   * this module does not own, in strings no import-level boundary check can
   * see. Three of them are contributed descriptors now
   * (`currencyReferenceRegistry`); the fourth is the kernel's channel table,
   * which this module may read through the ORM because the kernel is not a
   * module (D-32).
   *
   * Channels are counted in memory rather than in SQL: a deployment has tens of
   * them, both questions are about the same rows, and `currencies` is a JSON
   * array whose containment test was the reason the statement existed at all.
   */
  async countDependents(code: string): Promise<DictionaryReference[]> {
    const channels = await this.emFactory().find(SalesChannel, {});
    const references: DictionaryReference[] = [];

    const asDefault = channels.filter((channel) => channel.defaultCurrency === code).length;
    if (asDefault > 0) {
      references.push({
        ownerModuleId: 'sales_channels',
        consumer: 'sales_channels',
        tableName: 'sales_channels',
        columnName: 'default_currency',
        code,
        count: asDefault,
        blocking: true,
      });
    }

    const listed = channels.filter((channel) => channel.currencies.includes(code)).length;
    if (listed > 0) {
      references.push({
        ownerModuleId: 'sales_channels',
        consumer: 'sales_channels',
        tableName: 'sales_channels',
        columnName: 'currencies[]',
        code,
        count: listed,
        blocking: true,
      });
    }

    const registry = this.referenceRegistry?.();
    if (registry) references.push(...(await registry.countReferences(code)));
    return references;
  }

  async remove(code: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Currency, { code });
    if (!row) return;
    if (row.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot remove the default currency.',
      );
    }
    const dependents = await this.countDependents(code);
    // A non-blocking reference is still reported — `countries.default_currency_code`
    // has `on delete set null`, so it is a column an operator is about to blank
    // rather than a delete to refuse. Which references are which is the
    // contributing module's call, carried on the descriptor.
    const blocking = dependents
      .filter((reference) => reference.blocking)
      .reduce((total, reference) => total + reference.count, 0);
    if (blocking > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_ENTRY_HAS_DEPENDENTS,
        `Currency ${code} cannot be deleted because ${blocking} consumer reference(s) exist.`,
        [{ path: 'consumers', issue: JSON.stringify(dependents) }],
      );
    }
    this.#audit(em, 'currency.delete', row.code, { label: row.label }, null);
    await em.removeAndFlush(row);
    await this.invalidateDictionaryCache?.();
  }
}
