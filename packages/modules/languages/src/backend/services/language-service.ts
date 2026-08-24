import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type DictionaryReference,
  type DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { Language } from '../entities/language.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

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
    // `code` tiebreak keeps the order deterministic when several languages
    // share a sortOrder (e.g. the seed default 0) — matches list() above.
    return em.find(Language, { isActive: true }, { orderBy: { sortOrder: 'asc', code: 'asc' } });
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

  /**
   * Every consumer reference to `code`, across the platform (feature 077, D-87).
   *
   * This used to be six hand-written `count(*)` statements naming
   * `sales_channels`, `megamenu_bindings`, `blog_post_languages`,
   * `blog_category_languages` and `cms_pages` — five tables this module does not
   * own, in strings no import-level boundary check can see. Four of them are
   * contributed descriptors now (`languageReferenceRegistry`); the fifth is the
   * kernel's channel table, which this module may read through the ORM because
   * the kernel is not a module (D-32).
   *
   * Channels are counted in memory rather than in SQL: a deployment has tens of
   * them, both questions are about the same rows, and `languages` is a JSON
   * array whose containment test was the reason the statement existed at all.
   */
  async countDependents(code: string): Promise<DictionaryReference[]> {
    const channels = await this.emFactory().find(SalesChannel, {});
    const references: DictionaryReference[] = [];

    const asDefault = channels.filter((channel) => channel.defaultLanguage === code).length;
    if (asDefault > 0) {
      references.push({
        ownerModuleId: 'sales_channels',
        consumer: 'sales_channels',
        tableName: 'sales_channels',
        columnName: 'default_language',
        code,
        count: asDefault,
        blocking: true,
      });
    }

    const listed = channels.filter((channel) => channel.languages.includes(code)).length;
    if (listed > 0) {
      references.push({
        ownerModuleId: 'sales_channels',
        consumer: 'sales_channels',
        tableName: 'sales_channels',
        columnName: 'languages[]',
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
    // Which references refuse the delete is the contributing module's call,
    // carried on the descriptor: a column its own foreign key blanks on delete
    // is reported but does not block.
    const total = dependents
      .filter((reference) => reference.blocking)
      .reduce((sum, reference) => sum + reference.count, 0);
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
