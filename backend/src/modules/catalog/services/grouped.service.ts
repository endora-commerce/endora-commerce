import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CommandBus } from '../../../commands/index.js';
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
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits grouped-item writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

  /** Feature 054 — run a grouped-item write through the Command Bus. */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType: 'grouped_item', objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

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
    const id = randomUUID();
    const row = await this.#audited('grouped_item.add', id, async (cem) => {
      const r = cem.create(GroupedItem, {
        id,
        parentProductId,
        childProductId: input.childProductId,
        quantity: input.quantity,
        position,
      });
      try {
        await cem.flush();
      } catch (err) {
        if (err instanceof Error && /uniq_grouped_items_parent_child/.test(err.message)) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            `Child product "${input.childProductId}" is already in this group.`,
          );
        }
        throw err;
      }
      return {
        result: r,
        before: null,
        after: {
          parentProductId,
          childProductId: input.childProductId,
          quantity: input.quantity,
          position,
        },
      };
    });
    return this.toRow(row);
  }

  async updateItem(
    parentProductId: string,
    itemId: string,
    input: { quantity?: number | undefined; position?: number | undefined },
  ): Promise<GroupedItemRow> {
    const row = await this.#audited('grouped_item.update', itemId, async (em) => {
      await this.assertGroupedParent(em, parentProductId);
      const r = await em.findOne(GroupedItem, { id: itemId, parentProductId });
      if (!r) {
        throw new HttpError(
          404,
          ERROR_CODES.GROUPED_ITEM_NOT_FOUND,
          `Grouped item "${itemId}" not found on parent ${parentProductId}.`,
        );
      }
      const before = { quantity: r.quantity, position: r.position };
      if (input.quantity !== undefined) {
        if (input.quantity <= 0) {
          throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'quantity must be positive.');
        }
        r.quantity = input.quantity;
      }
      if (input.position !== undefined) r.position = input.position;
      return { result: r, before, after: { quantity: r.quantity, position: r.position } };
    });
    return this.toRow(row);
  }

  async removeItem(parentProductId: string, itemId: string): Promise<void> {
    await this.#audited('grouped_item.delete', itemId, async (em) => {
      await this.assertGroupedParent(em, parentProductId);
      const row = await em.findOne(GroupedItem, { id: itemId, parentProductId });
      if (!row) {
        throw new HttpError(
          404,
          ERROR_CODES.GROUPED_ITEM_NOT_FOUND,
          `Grouped item "${itemId}" not found on parent ${parentProductId}.`,
        );
      }
      const before = { parentProductId, childProductId: row.childProductId };
      em.remove(row);
      return { result: undefined, before, after: null };
    });
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
