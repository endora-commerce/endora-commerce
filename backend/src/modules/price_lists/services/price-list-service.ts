import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListItem } from '../entities/price-list-item.entity.js';
import { PriceListAssignment } from '../entities/price-list-assignment.entity.js';

/**
 * PriceListService — admin CRUD over PriceList + the two child collections
 * (items + assignments). Keeping all three operations on the same service
 * keeps the "edit a price list and its rules" admin flow on one transaction
 * boundary when we need it later.
 */
export class PriceListService {
  constructor(private readonly emFactory: () => EntityManager) {}

  // ---- PriceList -----------------------------------------------------

  async list(): Promise<PriceList[]> {
    return this.emFactory().find(PriceList, {}, { orderBy: { priority: 'desc', code: 'asc' } });
  }

  async getById(id: string): Promise<PriceList> {
    const row = await this.emFactory().findOne(PriceList, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price list ${id} not found.`);
    return row;
  }

  async upsertByCode(input: {
    code: string;
    name: string;
    currency: string;
    isDefault?: boolean | undefined;
    priority?: number | undefined;
  }): Promise<PriceList> {
    const em = this.emFactory();
    const existing = await em.findOne(PriceList, { code: input.code });
    if (input.isDefault) {
      // The unique partial index `(is_default) WHERE is_default=true` enforces
      // at most one default. Demote the prior default first so the swap is
      // atomic.
      await em.getConnection().execute(
        `update price_lists set is_default = false where is_default = true and code <> ?`,
        [input.code],
      );
    }
    if (existing) {
      existing.name = input.name;
      existing.currency = input.currency;
      if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
      if (input.priority !== undefined) existing.priority = input.priority;
      await em.flush();
      return existing;
    }
    const row = em.create(PriceList, {
      code: input.code,
      name: input.name,
      currency: input.currency,
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceList, { id });
    if (!row) return;
    await em.removeAndFlush(row);
  }

  // ---- PriceListItem -------------------------------------------------

  async listItems(priceListId: string): Promise<PriceListItem[]> {
    return this.emFactory().find(PriceListItem, { priceListId }, { orderBy: { mode: 'asc', minQuantity: 'asc' } });
  }

  async createItem(
    priceListId: string,
    input: {
      mode: 'fixed_unit' | 'percentage_off' | 'amount_off';
      productId?: string | null;
      variantId?: string | null;
      categoryId?: string | null;
      minQuantity?: number;
      unitPrice?: number | null;
      adjustmentValue?: number | null;
    },
  ): Promise<PriceListItem> {
    const em = this.emFactory();
    await this.getById(priceListId); // 404-guard
    const row = em.create(PriceListItem, {
      priceListId,
      mode: input.mode,
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.variantId !== undefined ? { variantId: input.variantId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.minQuantity !== undefined ? { minQuantity: input.minQuantity } : {}),
      ...(input.unitPrice !== undefined && input.unitPrice !== null
        ? { unitPrice: String(input.unitPrice) }
        : {}),
      ...(input.adjustmentValue !== undefined && input.adjustmentValue !== null
        ? { adjustmentValue: String(input.adjustmentValue) }
        : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async removeItem(itemId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceListItem, { id: itemId });
    if (!row) return;
    await em.removeAndFlush(row);
  }

  // ---- PriceListAssignment -------------------------------------------

  async listAssignments(priceListId: string): Promise<PriceListAssignment[]> {
    return this.emFactory().find(PriceListAssignment, { priceListId }, { orderBy: { priority: 'desc' } });
  }

  async createAssignment(
    priceListId: string,
    input: {
      organizationId?: string | null;
      customerGroupId?: string | null;
      salesChannelId?: string | null;
      isDefault?: boolean;
      priority?: number;
    },
  ): Promise<PriceListAssignment> {
    const em = this.emFactory();
    await this.getById(priceListId);
    const row = em.create(PriceListAssignment, {
      priceListId,
      ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      ...(input.customerGroupId !== undefined ? { customerGroupId: input.customerGroupId } : {}),
      ...(input.salesChannelId !== undefined ? { salesChannelId: input.salesChannelId } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async removeAssignment(assignmentId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PriceListAssignment, { id: assignmentId });
    if (!row) return;
    await em.removeAndFlush(row);
  }
}
