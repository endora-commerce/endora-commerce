import type { EntityManager } from '@mikro-orm/postgresql';

import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../entities/product.entity.js';
import { GroupedItem } from '../entities/grouped-item.entity.js';

/**
 * GroupedService — admin CRUD for grouped product children (feature 002
 * US5, T128). The parent product MUST be `type='grouped'`; children MUST
 * NOT be `type='grouped'` or `type='bundle'` (research R-8 — no nested
 * composites, enforced at the service layer because PG CHECK can't JOIN
 * `products`).
 */

export interface GroupedItemRow {
  id: string;
  parentProductId: string;
  childProductId: string;
  quantity: number;
  position: number;
}

export class GroupedService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(parentProductId: string): Promise<GroupedItemRow[]> {
    const em = this.emFactory();
    await this.assertGroupedParent(em, parentProductId);
    const rows = await em.find(
      GroupedItem,
      { parentProductId },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    return rows.map((r) => this.toRow(r));
  }

  async addItem(
    parentProductId: string,
    input: { childProductId: string; quantity: number; position?: number | undefined },
  ): Promise<GroupedItemRow> {
    const em = this.emFactory();
    await this.assertGroupedParent(em, parentProductId);
    if (input.childProductId === parentProductId) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'A grouped product cannot include itself as a child.',
      );
    }
    const child = await em.findOne(Product, { id: input.childProductId });
    if (!child || child.deletedAt) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Child product "${input.childProductId}" not found.`,
      );
    }
    if (child.type === 'grouped' || child.type === 'bundle') {
      throw new HttpError(
        400,
        ERROR_CODES.NESTED_COMPOSITE_NOT_ALLOWED,
        `Grouped products cannot include another ${child.type} product as a child.`,
      );
    }
    if (input.quantity <= 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'quantity must be positive.',
      );
    }
    // Append by default; admin can override.
    let position = input.position;
    if (position === undefined) {
      const tally = await em.find(GroupedItem, { parentProductId });
      position = tally.reduce((max, r) => Math.max(max, r.position + 1), 0);
    }
    const row = em.create(GroupedItem, {
      parentProductId,
      childProductId: input.childProductId,
      quantity: input.quantity,
      position,
    });
    try {
      await em.persistAndFlush(row);
    } catch (err) {
      if (
        err instanceof Error &&
        /uniq_grouped_items_parent_child/.test(err.message)
      ) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Child product "${input.childProductId}" is already in this group.`,
        );
      }
      throw err;
    }
    return this.toRow(row);
  }

  async updateItem(
    parentProductId: string,
    itemId: string,
    input: { quantity?: number | undefined; position?: number | undefined },
  ): Promise<GroupedItemRow> {
    const em = this.emFactory();
    await this.assertGroupedParent(em, parentProductId);
    const row = await em.findOne(GroupedItem, { id: itemId, parentProductId });
    if (!row) {
      throw new HttpError(
        404,
        ERROR_CODES.GROUPED_ITEM_NOT_FOUND,
        `Grouped item "${itemId}" not found on parent ${parentProductId}.`,
      );
    }
    if (input.quantity !== undefined) {
      if (input.quantity <= 0) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'quantity must be positive.',
        );
      }
      row.quantity = input.quantity;
    }
    if (input.position !== undefined) row.position = input.position;
    await em.flush();
    return this.toRow(row);
  }

  async removeItem(parentProductId: string, itemId: string): Promise<void> {
    const em = this.emFactory();
    await this.assertGroupedParent(em, parentProductId);
    const row = await em.findOne(GroupedItem, { id: itemId, parentProductId });
    if (!row) {
      throw new HttpError(
        404,
        ERROR_CODES.GROUPED_ITEM_NOT_FOUND,
        `Grouped item "${itemId}" not found on parent ${parentProductId}.`,
      );
    }
    await em.removeAndFlush(row);
  }

  private async assertGroupedParent(
    em: EntityManager,
    parentProductId: string,
  ): Promise<Product> {
    const parent = await em.findOne(Product, { id: parentProductId });
    if (!parent || parent.deletedAt) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product "${parentProductId}" not found.`,
      );
    }
    if (parent.type !== 'grouped') {
      throw new HttpError(
        400,
        ERROR_CODES.PRODUCT_TYPE_MISMATCH,
        `Product type is "${parent.type}", expected "grouped".`,
      );
    }
    return parent;
  }

  private toRow(r: GroupedItem): GroupedItemRow {
    return {
      id: r.id,
      parentProductId: r.parentProductId,
      childProductId: r.childProductId,
      quantity: r.quantity,
      position: r.position,
    };
  }
}
