import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES, type CreateCategoryRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CommandBus } from '../../../commands/index.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { Category } from '../entities/category.entity.js';

/** Result of a category write closure: the entity + its audit snapshot. */
interface CategoryWrite {
  result: Category;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  skipAudit?: boolean;
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

export interface UpdateCategoryInput {
  parentCategoryId?: string | null;
  name?: Record<string, string>;
  slug?: string;
  sortOrder?: number;
  /** Feature 013 / US5 — Library Asset rendered as the storefront category main image. */
  mainImageAssetId?: string | null;
}

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
    private readonly salesChannelMembership?: SalesChannelMembershipService,
    /** Feature 054 — audits category writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

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
      return this.commandBus.run({
        action,
        objectType: 'category',
        objectId,
        run: async ({ em }) => {
          const w = await write(em);
          return {
            result: w.result,
            before: w.before,
            after: w.after,
            ...(w.skipAudit ? { skipAudit: true } : {}),
          };
        },
      });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush(); // no-op when the closure already flushed (create/update)
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
      if (input.mainImageAssetId !== undefined) cat.mainImageAssetId = input.mainImageAssetId;
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
        },
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
