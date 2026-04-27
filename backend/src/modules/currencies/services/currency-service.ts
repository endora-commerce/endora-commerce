import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Currency } from '../entities/currency.entity.js';

/**
 * CurrencyService — admin CRUD over the currencies pool (T238 / FR-105).
 * Mirrors LanguageService; the same "at most one default" invariant is
 * enforced by a partial unique index in the migration.
 */
export class CurrencyService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
      existing.label = input.label;
      existing.symbol = input.symbol;
      if (input.isActive !== undefined) existing.isActive = input.isActive;
      if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
      await em.flush();
      return existing;
    }
    const row = em.create(Currency, {
      code: input.code,
      label: input.label,
      symbol: input.symbol,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    await em.persistAndFlush(row);
    return row;
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

    return em.transactional(async (txEm) => {
      const conn = txEm.getConnection();
      await conn.execute('update currencies set is_default = false where is_default = true');
      target.isDefault = true;
      await txEm.flush();
      return target;
    });
  }

  async remove(code: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Currency, { code });
    if (!row) return;
    if (row.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot remove the default currency.',
      );
    }
    await em.removeAndFlush(row);
  }
}
