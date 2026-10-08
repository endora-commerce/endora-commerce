import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CategoryContentEnvelope,
  type CreateCategoryRequest,
  type CustomFieldValuePort,
  type UpdateCategoryInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import type { CommandBus, CommandEvent } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Category } from '../entities/category.entity.js';

/** Result of a category write closure: the entity + its audit snapshot. */
interface CategoryWrite {
  result: Category;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  skipAudit?: boolean;
  /**
   * Feature 068 — domain event dispatched once the write commits (dropped on
   * rollback), in the shape the Command Bus expects.
   */
  event?: CommandEvent;
}

/**
 * Feature 068 — events this service publishes.
 *
 * `category.updated.v1` carries the changed category id. The search module
 * subscribes to it and re-indexes every product in the affected subtree,
 * because a category's slug and its activation state are both projected onto
 * the product documents (`categorySlugs`) that back the storefront PLP.
 */
export interface CategoryEvents extends Record<string, EventBase> {
  'category.updated.v1': EventBase & { categoryId: string };
  /**
   * The category's page content changed and nothing else did.
   *
   * A separate event rather than a second cause of `category.updated.v1`,
   * because that one is what `search` re-projects a whole subtree of products
   * on — the slug and the activation state are on the product documents, and
   * the page content is on none of them. Saving a paragraph should flush the
   * storefront's category cache and should not re-index a branch.
   */
  'category.content.updated.v1': EventBase & { categoryId: string };
}

export type CategoryEventBus = EventBus<CategoryEvents>;

function categoryUpdatedEvent(
  categoryId: string,
): CommandEvent<CategoryEvents['category.updated.v1']> {
  return {
    eventName: 'category.updated.v1',
    payload: {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      categoryId,
    },
  };
}

function categoryContentUpdatedEvent(
  categoryId: string,
): CommandEvent<CategoryEvents['category.content.updated.v1']> {
  return {
    eventName: 'category.content.updated.v1',
    payload: {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      categoryId,
    },
  };
}

/** The languages an envelope carries — what the audit row records of it. */
function contentLanguagesOf(content: CategoryContentEnvelope): string[] {
  return Object.keys(content?.languages ?? {}).sort();
}

/**
 * CategoryAdminService (T090). Backs the admin Categories tree editor.
 *
 * Two invariants:
 *   - parent must exist (or be null for a root)
 *   - moving a category MUST NOT create a cycle — when reparenting, walk
 *     up the new parent's chain and refuse if the moved id appears.
 *
 * Soft delete (`deletedAt`) is used so categorised products keep their
 * historical reference; the public catalog filters them out.
 */

/**
 * The patch this service's `update` accepts.
 *
 * Published in `@endora-commerce/contracts` in feature 075's Phase P — the category write
 * port takes it — and aliased back here so the two cannot drift.
 */
export type { UpdateCategoryInput };

export class CategoryAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 005 / T027b — when injected, every newly-created Category
     * that does not declare explicit channel membership lands in the
     * system-default Sales Channel automatically (FR-011). Optional so
     * existing tests that construct this service without sales-channels
     * keep compiling; production composition.ts always provides it.
     */
    private readonly salesChannelMembership?: SalesChannelMembershipPort,
    /** Feature 054 — audits category writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /** Feature 055 — validates + merges custom-field values on category write. */
    private readonly customFieldValues?: CustomFieldValuePort,
    /**
     * Feature 068 — publishes `category.updated.v1`. Only consulted on the
     * bus-less fallback path: when a Command Bus is injected it dispatches the
     * command's event itself, on commit.
     */
    private readonly events?: CategoryEventBus,
  ) {}

  /** Validate + merge a custom-field patch, mapping validation errors to HTTP 422. */
  async #mergeCustomFields(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.customFieldValues) return current;
    try {
      return await this.customFieldValues.validateAndMerge('category', current ?? {}, patch);
    } catch (err) {
      // Feature 075 — narrowed structurally, not by `instanceof` on
      // `custom_fields`' class. The guard tests `name` and the `errors`
      // array, which is what still works once each module is its own npm
      // package; and the re-throw below stays unconditional, so a
      // `ModuleDisabledError` from the port leaves through it.
      if (isCustomFieldValidationFailure(err)) {
        throw new HttpError(
          422,
          ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
          'One or more custom fields are invalid.',
          err.errors.map((e) => ({ path: e.field, issue: e.message })),
        );
      }
      throw err;
    }
  }

  /**
   * Feature 054 — run a category write through the Command Bus (co-transactional
   * audit) or a plain forked em (bus-less tests). `write` performs the mutation
   * on the given em and returns the entity + before/after snapshot.
   */
  async #audited(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<CategoryWrite>,
  ): Promise<Category> {
    if (this.commandBus) {
      // The event is declared per run, so `event()` can hand the bus whatever
      // the closure produced. Captured here rather than on the entity because
      // the bus dispatches it after the transaction commits.
      let declared: CommandEvent | undefined;
      return this.commandBus.run({
        action,
        objectType: 'category',
        objectId,
        run: async ({ em }) => {
          const w = await write(em);
          declared = w.event;
          return {
            result: w.result,
            before: w.before,
            after: w.after,
            ...(w.skipAudit ? { skipAudit: true } : {}),
          };
        },
        event: () => declared,
      });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush(); // no-op when the closure already flushed (create/update)
    if (w.event) {
      this.events?.emit(
        w.event.eventName as keyof CategoryEvents & string,
        w.event.payload as CategoryEvents[keyof CategoryEvents & string],
      );
    }
    return w.result;
  }

  async listAll(): Promise<Category[]> {
    const em = this.emFactory();
    return em.find(
      Category,
      { deletedAt: null },
      { orderBy: { sortOrder: 'asc', slug: 'asc' } },
    );
  }

  async create(input: CreateCategoryRequest): Promise<Category> {
    const id = randomUUID();
    const cat = await this.#audited('category.create', id, async (em) => {
      if (input.parentCategoryId) await this.#assertParentExists(em, input.parentCategoryId);
      const created = em.create(Category, {
        id,
        ...(input.parentCategoryId !== undefined
          ? { parentCategoryId: input.parentCategoryId }
          : {}),
        name: input.name,
        slug: input.slug,
        sortOrder: input.sortOrder ?? 0,
        // Feature 068 — omitted means active (the column default).
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            `Slug "${input.slug}" already exists under this parent.`,
          );
        }
        throw err;
      }
      return {
        result: created,
        before: null,
        after: {
          name: created.name,
          slug: created.slug,
          parentCategoryId: created.parentCategoryId ?? null,
          sortOrder: created.sortOrder,
          isActive: created.isActive,
        },
      };
    });
    // Feature 005 / FR-011 — bind to Default unless this category was
    // already given memberships through some other path.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('category', cat.id);
    }
    return cat;
  }

  async update(id: string, input: UpdateCategoryInput): Promise<Category> {
    return this.#audited('category.update', id, async (em) => {
      const cat = await em.findOne(Category, { id, deletedAt: null });
      if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
      const before = {
        name: cat.name,
        slug: cat.slug,
        parentCategoryId: cat.parentCategoryId ?? null,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      };
      if (input.parentCategoryId !== undefined) {
        if (input.parentCategoryId !== null) {
          await this.#assertParentExists(em, input.parentCategoryId);
          await this.#assertNoCycle(em, id, input.parentCategoryId);
        }
        cat.parentCategoryId = input.parentCategoryId;
      }
      if (input.name !== undefined) cat.name = input.name;
      if (input.slug !== undefined) cat.slug = input.slug;
      if (input.sortOrder !== undefined) cat.sortOrder = input.sortOrder;
      if (input.isActive !== undefined) cat.isActive = input.isActive;
      if (input.mainImageAssetId !== undefined) cat.mainImageAssetId = input.mainImageAssetId;
      if (input.customFieldValues !== undefined) {
        cat.customFieldValues = await this.#mergeCustomFields(cat.customFieldValues ?? {}, input.customFieldValues);
      }
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            'Another category already uses this slug under that parent.',
          );
        }
        throw err;
      }
      return {
        result: cat,
        before,
        after: {
          name: cat.name,
          slug: cat.slug,
          parentCategoryId: cat.parentCategoryId ?? null,
          sortOrder: cat.sortOrder,
          isActive: cat.isActive,
        },
        // Feature 068 — the subtree's products carry this category's slug and
        // (through the activation flag) their reachability, so every update
        // has to reach the search index.
        event: categoryUpdatedEvent(cat.id),
      };
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.#audited('category.delete', id, async (em) => {
      const cat = await em.findOne(Category, { id, deletedAt: null });
      if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
      const childCount = await em.count(Category, { parentCategoryId: id, deletedAt: null });
      if (childCount > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete: ${childCount} child category(ies) still attached. Move or delete them first.`,
        );
      }
      cat.deletedAt = new Date();
      return { result: cat, before: { name: cat.name, slug: cat.slug }, after: { deletedAt: cat.deletedAt } };
    });
  }

  /**
   * The category's page content — the whole per-language envelope, or `null`
   * when none was authored. 404 for an unknown or soft-deleted category.
   *
   * `populate: ['content']` is what loads it: the property is lazy, so every
   * other read of this entity leaves the document in the database.
   */
  async getContent(id: string): Promise<CategoryContentEnvelope> {
    const cat = await this.emFactory().findOne(
      Category,
      { id, deletedAt: null },
      { populate: ['content'] },
    );
    if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
    return cat.content ?? null;
  }

  /**
   * Replace the category's page content. `null` clears it.
   *
   * Its own Command (`category.content.update`) and its own event, rather
   * than one more key on {@link update}: the document is authored on its own
   * screen, saved on its own button, and may weigh a megabyte — so the audit
   * row records **which languages** the envelope carried before and after,
   * never the documents, and the event is the one that does not re-index the
   * category's products (see {@link CategoryEvents}).
   */
  async setContent(
    id: string,
    content: CategoryContentEnvelope,
  ): Promise<CategoryContentEnvelope> {
    const cat = await this.#audited('category.content.update', id, async (em) => {
      const found = await em.findOne(
        Category,
        { id, deletedAt: null },
        { populate: ['content'] },
      );
      if (!found) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
      const before = { contentLanguages: contentLanguagesOf(found.content ?? null) };
      found.content = content;
      await em.flush();
      return {
        result: found,
        before,
        after: { contentLanguages: contentLanguagesOf(content) },
        event: categoryContentUpdatedEvent(found.id),
      };
    });
    return cat.content ?? null;
  }

  /**
   * Set the inventory display-band thresholds on a category (feature 075,
   * Phase C — published as `catalogCategoryWritePort.setInventoryThresholds`).
   *
   * `inventory` owns the meaning of these three columns and stored them here
   * because the storefront resolver reads them alongside the category row. It
   * wrote them by importing `Category`; this is the same write, on this side of
   * the boundary, and deliberately the same write and no more: no Command, no
   * `category.updated.v1`, no `category.update` audit row. The caller records
   * one `low_stock_threshold.update` summary row for the whole patch, and
   * routing this through {@link update} would give an operator reading a
   * category's history a second, differently-named entry for the same act.
   */
  async setInventoryThresholds(
    id: string,
    patch: { high?: number | null; medium?: number | null; low?: number | null },
  ): Promise<void> {
    // command-coverage-ignore: three threshold columns on a category row, audited
    // by the caller as one `low_stock_threshold.update` summary — see the doc
    // comment above and `ThresholdAdminService.patch`.
    const em = this.emFactory();
    const cat = await em.findOne(Category, { id, deletedAt: null });
    if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Category ${id} not found`);
    if (patch.high !== undefined) cat.inventoryThresholdHigh = patch.high;
    if (patch.medium !== undefined) cat.inventoryThresholdMedium = patch.medium;
    if (patch.low !== undefined) cat.inventoryThresholdLow = patch.low;
    await em.flush();
  }

  async #assertParentExists(em: EntityManager, parentId: string): Promise<void> {
    const exists = await em.count(Category, { id: parentId, deletedAt: null });
    if (exists === 0) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Parent category not found.');
    }
  }

  async #assertNoCycle(em: EntityManager, movedId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === movedId) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          'Cannot move category beneath one of its descendants.',
        );
      }
      if (seen.has(cursor)) break; // defensive guard against pre-existing cycles
      seen.add(cursor);
      const parent: Category | null = await em.findOne(Category, { id: cursor });
      cursor = parent?.parentCategoryId ?? null;
    }
  }
}
