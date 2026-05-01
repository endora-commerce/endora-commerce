import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES, type CreateCategoryRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import { Category } from '../entities/category.entity.js';

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
  ) {}

  async listAll(): Promise<Category[]> {
    const em = this.emFactory();
    return em.find(
      Category,
      { deletedAt: null },
      { orderBy: { sortOrder: 'asc', slug: 'asc' } },
    );
  }

  async create(input: CreateCategoryRequest): Promise<Category> {
    const em = this.emFactory();
    if (input.parentCategoryId) await this.#assertParentExists(em, input.parentCategoryId);
    const cat = em.create(Category, {
      ...(input.parentCategoryId !== undefined
        ? { parentCategoryId: input.parentCategoryId }
        : {}),
      name: input.name,
      slug: input.slug,
      sortOrder: input.sortOrder ?? 0,
    });
    try {
      await em.persistAndFlush(cat);
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
    // Feature 005 / FR-011 — bind to Default unless this category was
    // already given memberships through some other path.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('category', cat.id);
    }
    return cat;
  }

  async update(id: string, input: UpdateCategoryInput): Promise<Category> {
    const em = this.emFactory();
    const cat = await em.findOne(Category, { id, deletedAt: null });
    if (!cat) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Category not found.');
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
    return cat;
  }

  async softDelete(id: string): Promise<void> {
    const em = this.emFactory();
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
