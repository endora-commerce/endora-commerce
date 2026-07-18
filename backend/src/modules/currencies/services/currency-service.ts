import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../entities/currency.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

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
    private readonly auditLog?: AuditLogService,
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
    return em.find(Currency, { isActive: true }, { orderBy: { sortOrder: 'asc' } });
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

  async countDependents(code: string): Promise<{
    salesChannelDefaults: number;
    salesChannelLists: number;
    promotions: number;
    priceLists: number;
    countriesDefault: number;
  }> {
    const conn = this.emFactory().getConnection();
    const [scDefault, scList, promo, pl, countries] = await Promise.all([
      conn.execute(
        `select count(*)::int as n from "sales_channels" where "default_currency" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "sales_channels" where "currencies" @> ?::jsonb`,
        [JSON.stringify([code])],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "promotions" where "currency" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "price_lists" where "currency" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "countries" where "default_currency_code" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
    ]);
    return {
      salesChannelDefaults: scDefault[0]?.n ?? 0,
      salesChannelLists: scList[0]?.n ?? 0,
      promotions: promo[0]?.n ?? 0,
      priceLists: pl[0]?.n ?? 0,
      countriesDefault: countries[0]?.n ?? 0,
    };
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
    // `countriesDefault` is benign — countries.default_currency_code has
    // ON DELETE SET NULL — but we still surface it for operator visibility.
    const blocking =
      dependents.salesChannelDefaults +
      dependents.salesChannelLists +
      dependents.promotions +
      dependents.priceLists;
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
