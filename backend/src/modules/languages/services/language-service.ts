import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Language } from '../entities/language.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

/**
 * LanguageService — admin CRUD over the languages pool.
 *
 * Originally introduced by feature 004 (T238 / FR-105) for the minimal
 * languages table. Extended by feature 017 to cover the new columns
 * (`nativeLabel`, `isRtl`, `fallbackCode`) and the spec invariants:
 *
 *   - exactly one default at a time (partial unique index, transactional
 *     promote+demote).
 *   - at-least-one-active (the only active row cannot be deactivated).
 *   - default-cannot-be-deactivated.
 *   - fallback-cycle guard (the `code → fallback_code → ...` chain must
 *     terminate without revisiting any node).
 *   - FK-protected hard-delete: refused while any consumer references the
 *     language (sales channels' default_language + languages JSONB,
 *     megamenu bindings, blog post / category languages, CMS page
 *     languages).
 */
export class LanguageService {
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
        objectType: 'language',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

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

  async getByCode(code: string): Promise<Language | null> {
    const em = this.emFactory();
    return em.findOne(Language, { code });
  }

  async create(input: {
    code: string;
    label: string;
    nativeLabel: string;
    isRtl?: boolean;
    fallbackCode?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<Language> {
    const em = this.emFactory();
    const existing = await em.findOne(Language, { code: input.code });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Language ${input.code} already exists.`,
      );
    }
    if (input.fallbackCode !== undefined && input.fallbackCode !== null) {
      if (input.fallbackCode === input.code) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_FALLBACK_CYCLE,
          'A language cannot fall back to itself.',
        );
      }
      await this.assertNoCycle(em, input.code, input.fallbackCode);
    }
    const row = em.create(Language, {
      code: input.code,
      label: input.label,
      nativeLabel: input.nativeLabel,
      ...(input.isRtl !== undefined ? { isRtl: input.isRtl } : {}),
      ...(input.fallbackCode !== undefined ? { fallbackCode: input.fallbackCode } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    em.persist(row);
    this.#audit(em, 'language.create', row.code, null, { label: row.label });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  /**
   * Legacy upsert kept for the existing `/api/v1/admin/languages/:code`
   * endpoint. Sets only the legacy fields. The dictionary admin surface
   * uses `update()` for the extended fields.
   */
  async upsert(input: {
    code: string;
    label: string;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<Language> {
    const em = this.emFactory();
    const existing = await em.findOne(Language, { code: input.code });
    if (existing) {
      // Default-cannot-be-deactivated invariant.
      if (input.isActive === false && existing.isDefault) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
          'Cannot deactivate the default language. Promote a different language first.',
        );
      }
      if (input.isActive === false && existing.isActive) {
        const otherActive = await em.count(Language, {
          isActive: true,
          code: { $ne: input.code },
        });
        if (otherActive === 0) {
          throw new HttpError(
            409,
            ERROR_CODES.DICTIONARY_LAST_ACTIVE_ENTRY,
            'At least one language must remain active.',
          );
        }
      }
      existing.label = input.label;
      if (input.isActive !== undefined) existing.isActive = input.isActive;
      if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
      this.#audit(em, 'language.upsert', existing.code, null, { label: existing.label });
      await em.flush();
      await this.invalidateDictionaryCache?.();
      return existing;
    }
    const row = em.create(Language, {
      code: input.code,
      label: input.label,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    });
    em.persist(row);
    this.#audit(em, 'language.upsert', row.code, null, { label: row.label });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return row;
  }

  /**
   * Extended update used by the Dictionary admin surface (feature 017).
   * Supports every column on the Language entity and enforces the spec
   * invariants (default-cannot-be-deactivated, at-least-one-active,
   * fallback-cycle).
   */
  async update(
    code: string,
    input: {
      label?: string;
      nativeLabel?: string;
      isRtl?: boolean;
      fallbackCode?: string | null;
      isActive?: boolean;
      sortOrder?: number;
    },
  ): Promise<Language> {
    const em = this.emFactory();
    const existing = await em.findOne(Language, { code });
    if (!existing) {
      throw new HttpError(
        404,
        ERROR_CODES.DICTIONARY_ENTRY_NOT_FOUND,
        `Language ${code} not found.`,
      );
    }

    if (input.isActive === false && existing.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot deactivate the default language. Promote a different language first.',
      );
    }
    if (input.isActive === false && existing.isActive) {
      const otherActive = await em.count(Language, {
        isActive: true,
        code: { $ne: code },
      });
      if (otherActive === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_LAST_ACTIVE_ENTRY,
          'At least one language must remain active.',
        );
      }
    }

    if (input.fallbackCode !== undefined && input.fallbackCode !== null) {
      if (input.fallbackCode === code) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_FALLBACK_CYCLE,
          'A language cannot fall back to itself.',
        );
      }
      await this.assertNoCycle(em, code, input.fallbackCode);
    }

    if (input.label !== undefined) existing.label = input.label;
    if (input.nativeLabel !== undefined) existing.nativeLabel = input.nativeLabel;
    if (input.isRtl !== undefined) existing.isRtl = input.isRtl;
    if (input.fallbackCode !== undefined) existing.fallbackCode = input.fallbackCode;
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;

    this.#audit(em, 'language.update', existing.code, null, { label: existing.label, isActive: existing.isActive });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return existing;
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

    // Demote-then-promote inside the EM's current tx scope (em.transactional
    // would fork into a separate tx that commits independently — breaks the
    // test fork+rollback pattern and the cross-module composition root's
    // outer-tx semantics).
    await em.nativeUpdate(Language, { isDefault: true }, { isDefault: false });
    await em.nativeUpdate(Language, { code }, { isDefault: true });
    target.isDefault = true;
    this.#audit(em, 'language.set_default', code, null, { isDefault: true });
    await em.flush();
    await this.invalidateDictionaryCache?.();
    return target;
  }

  async countDependents(code: string): Promise<{
    salesChannelDefaults: number;
    salesChannelLists: number;
    megamenuBindings: number;
    blogPostLanguages: number;
    blogCategoryLanguages: number;
    cmsPages: number;
  }> {
    const conn = this.emFactory().getConnection();
    const [scDefault, scList, mm, bpl, bcl, cml] = await Promise.all([
      conn.execute(
        `select count(*)::int as n from "sales_channels" where "default_language" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "sales_channels" where "languages" @> ?::jsonb`,
        [JSON.stringify([code])],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "megamenu_bindings" where "language" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "blog_post_languages" where "language" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "blog_category_languages" where "language" = ?`,
        [code],
      ) as Promise<Array<{ n: number }>>,
      conn.execute(
        `select count(*)::int as n from "cms_pages" where "languages" @> ?::jsonb`,
        [JSON.stringify([code])],
      ) as Promise<Array<{ n: number }>>,
    ]);
    return {
      salesChannelDefaults: scDefault[0]?.n ?? 0,
      salesChannelLists: scList[0]?.n ?? 0,
      megamenuBindings: mm[0]?.n ?? 0,
      blogPostLanguages: bpl[0]?.n ?? 0,
      blogCategoryLanguages: bcl[0]?.n ?? 0,
      cmsPages: cml[0]?.n ?? 0,
    };
  }

  async remove(code: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Language, { code });
    if (!row) return;
    if (row.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED,
        'Cannot remove the default language.',
      );
    }
    const dependents = await this.countDependents(code);
    const total =
      dependents.salesChannelDefaults +
      dependents.salesChannelLists +
      dependents.megamenuBindings +
      dependents.blogPostLanguages +
      dependents.blogCategoryLanguages +
      dependents.cmsPages;
    if (total > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.DICTIONARY_ENTRY_HAS_DEPENDENTS,
        `Language ${code} cannot be deleted because ${total} consumer reference(s) exist.`,
        [{ path: 'consumers', issue: JSON.stringify(dependents) }],
      );
    }
    this.#audit(em, 'language.delete', row.code, { label: row.label }, null);
    await em.removeAndFlush(row);
    await this.invalidateDictionaryCache?.();
  }

  private async assertNoCycle(
    em: EntityManager,
    startCode: string,
    proposedFallback: string,
  ): Promise<void> {
    // Walk the existing graph from `proposedFallback` and ensure we never
    // arrive back at `startCode`. Bound the walk by the registry size so a
    // pathological dataset cannot loop.
    const visited = new Set<string>([startCode]);
    let cursor: string | null = proposedFallback;
    let steps = 0;
    const maxSteps = 32;
    while (cursor && steps < maxSteps) {
      if (visited.has(cursor)) {
        throw new HttpError(
          409,
          ERROR_CODES.DICTIONARY_FALLBACK_CYCLE,
          `Setting fallback_code to ${proposedFallback} would create a cycle through ${cursor}.`,
        );
      }
      visited.add(cursor);
      const next: Language | null = await em.findOne(Language, { code: cursor });
      cursor = next?.fallbackCode ?? null;
      steps += 1;
    }
  }
}
