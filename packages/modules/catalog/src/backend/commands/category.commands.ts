import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  isUuidShape,
  type CategoryContentEnvelope,
  type CategoryInventoryThresholdPatch,
  type CreateCategoryRequest,
  type CustomFieldMerge,
  type UpdateCategoryInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';
import { Category } from '../entities/category.entity.js';
import type { CategoryEvents } from '../services/category-admin.service.js';
import {
  requireLinkableAsset,
  requireLinkableContentAssets,
  type LinkableAssetReader,
} from '../services/linkable-asset.js';

/**
 * The Category aggregate's Commands (`specs/186-aggregate-ports/` US8, issue
 * #1826; research R-3). One factory per operation, run by the admin routes
 * (through `CategoryAdminService`) and by `catalogCategoryCommandPort` alike, so
 * the two cannot write, audit or emit differently.
 *
 * Every factory keeps the audit action and state the admin path recorded
 * before it moved here (FR-003): `category.create`, `category.update`,
 * `category.delete`, `category.content.update`. The one new action is
 * `category.inventory_thresholds.set` (research R-20.3), the threshold patch
 * that wrote unaudited until now.
 */

/**
 * Validates and merges a custom-field **patch** with the administrator's rules
 * (`CustomFieldValuePort.validateAndMerge`), a refusal mapped to
 * `422 CUSTOM_FIELD_VALUE_INVALID` — the admin editor's path. A port caller's
 * own merge ({@link CustomFieldMerge}) does not go through it.
 */
export type CategoryCustomFieldPatchMerge = (
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function categoryUpdatedEvent(categoryId: string): CommandEvent<CategoryEvents['category.updated.v1']> {
  return {
    eventName: 'category.updated.v1',
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), categoryId },
  };
}

function categoryContentUpdatedEvent(
  categoryId: string,
): CommandEvent<CategoryEvents['category.content.updated.v1']> {
  return {
    eventName: 'category.content.updated.v1',
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), categoryId },
  };
}

/** The languages an envelope carries — what the audit row records of it. */
function contentLanguagesOf(content: CategoryContentEnvelope): string[] {
  return Object.keys(content?.languages ?? {}).sort();
}

/** The live category a write targets: `404 NOT_FOUND` for a malformed, unknown or soft-deleted id. */
async function loadLiveCategory(em: EntityManager, id: string, message = 'Category not found.'): Promise<Category> {
  if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, message);
  const cat = await em.findOne(Category, { id, deletedAt: null });
  if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, message);
  return cat;
}

async function assertParentExists(em: EntityManager, parentId: string): Promise<void> {
  const exists = await em.count(Category, { id: parentId, deletedAt: null });
  if (exists === 0) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Parent category not found.');
  }
}

/** Moving a category MUST NOT create a cycle: walk up the new parent's chain. */
async function assertNoCycle(em: EntityManager, movedId: string, newParentId: string): Promise<void> {
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === movedId) {
      throw new HttpError(409, ERROR_CODES.CATEGORY_MOVE_CYCLE, 'Cannot move category beneath one of its descendants.', {
        categoryId: movedId,
        parentCategoryId: newParentId,
      });
    }
    if (seen.has(cursor)) break; // defensive guard against pre-existing cycles
    seen.add(cursor);
    const parent: Category | null = await em.findOne(Category, { id: cursor });
    cursor = parent?.parentCategoryId ?? null;
  }
}

/** `category.create` — the admin create (`POST …/categories`). */
export function makeCreateCategoryCommand(
  deps: { mergeCustomFields: CategoryCustomFieldPatchMerge },
  input: CreateCategoryRequest,
): Command<Category> {
  const id = randomUUID();
  return {
    action: 'category.create',
    objectType: 'category',
    objectId: id,
    run: async ({ em }) => {
      if (input.parentCategoryId) await assertParentExists(em, input.parentCategoryId);
      // Feature 175 (FR-015, FR-016) — validated as a merge onto an empty bag,
      // inside this Command: a refusal rolls the create back, a `required`
      // definition is refused even when no value is sent, and the audit row
      // below carries what was stored.
      const customFieldValues = await deps.mergeCustomFields({}, input.customFieldValues ?? {});
      const created = em.create(Category, {
        id,
        ...(input.parentCategoryId !== undefined ? { parentCategoryId: input.parentCategoryId } : {}),
        name: input.name,
        slug: input.slug,
        sortOrder: input.sortOrder ?? 0,
        // Feature 068 — omitted means active (the column default).
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        customFieldValues,
      });
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(409, ERROR_CODES.CATEGORY_SLUG_TAKEN, `Slug "${input.slug}" already exists under this parent.`, {
            slug: input.slug,
            parentCategoryId: input.parentCategoryId ?? null,
          });
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
          customFieldValues: created.customFieldValues,
        },
      };
    },
  };
}

/** {@link makeUpdateCategoryCommand}'s input. */
export interface UpdateCategoryCommandInput {
  readonly categoryId: string;
  /** The columns; an absent key is left alone. The custom-field bag is {@link customFields}. */
  readonly patch: Omit<UpdateCategoryInput, 'customFieldValues'>;
  /**
   * The custom-field write, when there is one: the caller's merge over a copy
   * of the stored bag, its answer stored. The admin path's merge validates a
   * patch ({@link CategoryCustomFieldPatchMerge}); a port caller's is its own.
   */
  readonly customFields?: CustomFieldMerge;
}

/**
 * `category.update` — the admin `PATCH …/categories/:id`, and through it the
 * port's `update`, `move` and `setCustomFieldValues` (research R-20.1, R-20.2).
 * Emits `category.updated.v1` on commit: search re-indexes the subtree and the
 * storefront's category cache is flushed.
 */
export function makeUpdateCategoryCommand(
  deps: { linkableAssets: () => LinkableAssetReader },
  input: UpdateCategoryCommandInput,
): Command<Category> {
  const { categoryId: id, patch } = input;
  return {
    action: 'category.update',
    objectType: 'category',
    objectId: id,
    run: async ({ em }) => {
      const cat = await loadLiveCategory(em, id);
      const before = {
        name: cat.name,
        slug: cat.slug,
        parentCategoryId: cat.parentCategoryId ?? null,
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      };
      if (patch.parentCategoryId !== undefined) {
        if (patch.parentCategoryId !== null) {
          await assertParentExists(em, patch.parentCategoryId);
          await assertNoCycle(em, id, patch.parentCategoryId);
        }
        cat.parentCategoryId = patch.parentCategoryId;
      }
      if (patch.name !== undefined) cat.name = patch.name;
      if (patch.slug !== undefined) cat.slug = patch.slug;
      if (patch.sortOrder !== undefined) cat.sortOrder = patch.sortOrder;
      if (patch.isActive !== undefined) cat.isActive = patch.isActive;
      if (patch.mainImageAssetId !== undefined) {
        // Feature 166 (FR-006) — a new image the caller may not see answers as
        // a missing one. The one already linked is this category's own
        // unrestricted reference, so it is visible and needs no question.
        if (patch.mainImageAssetId !== null && patch.mainImageAssetId !== (cat.mainImageAssetId ?? null)) {
          await requireLinkableAsset(deps.linkableAssets(), patch.mainImageAssetId);
        }
        cat.mainImageAssetId = patch.mainImageAssetId;
      }
      if (input.customFields !== undefined) {
        // A copy, so a merge that mutates its argument cannot rewrite the stored bag in place.
        cat.customFieldValues = await input.customFields({ ...(cat.customFieldValues ?? {}) });
      }
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(409, ERROR_CODES.CATEGORY_SLUG_TAKEN, 'Another category already uses this slug under that parent.', {
            slug: cat.slug,
            parentCategoryId: cat.parentCategoryId ?? null,
          });
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
      };
    },
    // Feature 068 — the subtree's products carry this category's slug and
    // (through the activation flag) their reachability, so every update has to
    // reach the search index.
    event: (cat) => categoryUpdatedEvent(cat.id),
  };
}

/** `category.delete` — the admin soft delete (`DELETE …/categories/:id`). */
export function makeDeleteCategoryCommand(input: { categoryId: string }): Command<Category> {
  const id = input.categoryId;
  return {
    action: 'category.delete',
    objectType: 'category',
    objectId: id,
    run: async ({ em }) => {
      const cat = await loadLiveCategory(em, id);
      const childCount = await em.count(Category, { parentCategoryId: id, deletedAt: null });
      if (childCount > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.CATEGORY_HAS_CHILDREN,
          `Cannot delete: ${childCount} child category(ies) still attached. Move or delete them first.`,
          { categoryId: id, childCount },
        );
      }
      cat.deletedAt = new Date();
      await em.flush();
      return { result: cat, before: { name: cat.name, slug: cat.slug }, after: { deletedAt: cat.deletedAt } };
    },
  };
}

/**
 * `category.content.update` — the category page content (`PUT …/:id/content`).
 * Not on the port: the content editor's own write. Its own event, which does
 * not re-index the category's products (see `CategoryEvents`).
 */
export function makeSetCategoryContentCommand(
  deps: { contentAssets: LinkableAssetReader | undefined },
  input: { categoryId: string; content: CategoryContentEnvelope },
): Command<Category> {
  return {
    action: 'category.content.update',
    objectType: 'category',
    objectId: input.categoryId,
    run: async ({ em }) => {
      const found = await em.findOne(
        Category,
        { id: input.categoryId, deletedAt: null },
        { populate: ['content'] },
      );
      if (!found) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
      // Issue #544 — an asset id the content newly embeds must be one the
      // caller may see, as for the main image.
      await requireLinkableContentAssets(deps.contentAssets, input.content, found.content ?? null);
      const before = { contentLanguages: contentLanguagesOf(found.content ?? null) };
      found.content = input.content;
      await em.flush();
      return { result: found, before, after: { contentLanguages: contentLanguagesOf(input.content) } };
    },
    event: (cat) => categoryContentUpdatedEvent(cat.id),
  };
}

type ThresholdState = {
  inventoryThresholdHigh: number | null;
  inventoryThresholdMedium: number | null;
  inventoryThresholdLow: number | null;
};

function thresholdsOf(cat: Category): ThresholdState {
  return {
    inventoryThresholdHigh: cat.inventoryThresholdHigh ?? null,
    inventoryThresholdMedium: cat.inventoryThresholdMedium ?? null,
    inventoryThresholdLow: cat.inventoryThresholdLow ?? null,
  };
}

/**
 * `category.inventory_thresholds.set` (research R-20.3) — the category's three
 * inventory display-band thresholds, which `inventory`'s threshold admin
 * patches. Audited here, by the columns' owner; `inventory`'s summary entry
 * records its own settings only. A patch that changes nothing records nothing.
 * Emits no event: no product document and no storefront category read carries
 * the thresholds through a cache this module flushes.
 */
export function makeSetCategoryInventoryThresholdsCommand(input: {
  categoryId: string;
  patch: CategoryInventoryThresholdPatch;
}): Command<Category> {
  const { categoryId: id, patch } = input;
  return {
    action: 'category.inventory_thresholds.set',
    objectType: 'category',
    objectId: id,
    run: async ({ em }) => {
      const cat = await loadLiveCategory(em, id, `Category ${id} not found`);
      const before = thresholdsOf(cat);
      if (patch.high !== undefined) cat.inventoryThresholdHigh = patch.high;
      if (patch.medium !== undefined) cat.inventoryThresholdMedium = patch.medium;
      if (patch.low !== undefined) cat.inventoryThresholdLow = patch.low;
      const after = thresholdsOf(cat);
      const changed = (Object.keys(before) as Array<keyof ThresholdState>).some((k) => before[k] !== after[k]);
      if (!changed) return { result: cat, skipAudit: true };
      await em.flush();
      return { result: cat, before, after };
    },
  };
}
