import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Language } from '../entities/language.entity.js';

/**
 * LanguageService — admin CRUD over the languages pool (T238 / FR-105).
 *
 * The "at most one default" invariant is enforced by a partial unique
 * index on `(is_default) WHERE is_default = true`. Setting a new default
 * runs in a transaction so the demote+promote pair never violates the
 * index mid-flight.
 */
export class LanguageService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<Language[]> {
    const em = this.emFactory();
    return em.find(Language, {}, { orderBy: { sortOrder: 'asc', code: 'asc' } });
  }

  async listActive(): Promise<Language[]> {
    const em = this.emFactory();
    return em.find(Language, { isActive: true }, { orderBy: { sortOrder: 'asc' } });
  }

  async getDefault(): Promise<Language | null> {
    const em = this.emFactory();
    return em.findOne(Language, { isDefault: true });
  }

  async upsert(input: {
    code: string;
    label: string;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<Language> {
    const em = this.emFactory();
    const existing = await em.findOne(Language, { code: input.code });
    if (existing) {
      existing.label = input.label;
      if (input.isActive !== undefined) existing.isActive = input.isActive;
      if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
      await em.flush();
      return existing;
    }
    const row = em.create(Language, {
      code: input.code,
      label: input.label,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async setDefault(code: string): Promise<Language> {
    const em = this.emFactory();
    const target = await em.findOne(Language, { code });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Language ${code} not found.`);
    }
    if (!target.isActive) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot mark an inactive language as default.',
      );
    }
    if (target.isDefault) return target;

    return em.transactional(async (txEm) => {
      const conn = txEm.getConnection();
      // Unset prior default first so the partial unique index is happy.
      await conn.execute('update languages set is_default = false where is_default = true');
      target.isDefault = true;
      await txEm.flush();
      return target;
    });
  }

  async remove(code: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Language, { code });
    if (!row) return;
    if (row.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot remove the default language.',
      );
    }
    await em.removeAndFlush(row);
  }
}
