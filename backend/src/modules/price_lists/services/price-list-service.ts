import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ApplicationRule } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListItem } from '../entities/price-list-item.entity.js';
import { PriceListAssignment } from '../entities/price-list-assignment.entity.js';
import { PriceListProduct } from '../entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';
import { randomUUID } from 'crypto';

export type PriceListStatus = 'draft' | 'active' | 'scheduled' | 'expired';
export type PriceListType = 'base' | 'sale';

export interface CreatePriceListInput {
  name: string;
  type: PriceListType;
  startsAt?: Date | null;
  endsAt?: Date | null;
  applicationRule?: ApplicationRule;
}

export interface PatchPriceListInput {
  name?: string;
  type?: PriceListType;
  startsAt?: Date | null;
  endsAt?: Date | null;
  applicationRule?: ApplicationRule;
}

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
    if (row.isSystem) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list cannot be deleted; it is the system fallback.',
      );
    }
    await em.removeAndFlush(row);
  }

  /**
   * Default-list rule-attachment guard (FR-006). Rejects any attempt to attach
   * a non-empty Application Rule to the seeded `Default` row.
   */
  async assertCanSetApplicationRule(
    id: string,
    rule: { kind: string },
  ): Promise<void> {
    const row = await this.getById(id);
    if (row.isSystem && rule.kind !== 'all') {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list cannot carry an Application Rule; it always matches as the global fallback.',
      );
    }
  }

  /**
   * Default-list status-change guard (FR-005 / FR-006 / spec.md §State Machines).
   * The system Default row stays `active` for the platform's lifetime. The
   * service rejects any attempt to move it to `draft`, `scheduled`, or `expired`.
   */
  async assertCanTransitionStatus(
    id: string,
    nextStatus: 'draft' | 'active' | 'scheduled' | 'expired',
  ): Promise<void> {
    const row = await this.getById(id);
    if (row.isSystem && nextStatus !== 'active') {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'The Default price list must remain active.',
      );
    }
  }

  // ---- Engine CRUD + lifecycle (feature 011) -------------------------

  /**
   * Create a new price list. Status defaults to `draft`. Default-list
   * protections are out of scope here — system rows are seeded by migration
   * 031, never created via this method.
   */
  async create(input: CreatePriceListInput): Promise<PriceList> {
    this.assertDateSanity(input.startsAt ?? null, input.endsAt ?? null, true);
    const em = this.emFactory();
    const row = em.create(PriceList, {
      // Legacy columns are required by the foundation schema; populate them
      // with engine-equivalent values so writes don't fail until contract
      // migration retires them.
      code: `pl-${randomUUID()}`,
      name: input.name,
      currency: 'PLN',
      isDefault: false,
      priority: 0,
      type: input.type,
      status: 'draft',
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      applicationRule: input.applicationRule ?? { kind: 'all' },
      isSystem: false,
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(row);
    return row;
  }

  /**
   * Partial update. Bumps `modifiedAt` on every material change.
   * Refuses non-empty rule attachment on the seeded `Default` row (FR-006).
   */
  async patch(id: string, input: PatchPriceListInput): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id);

    if (input.applicationRule !== undefined) {
      await this.assertCanSetApplicationRule(id, input.applicationRule);
    }

    const nextStartsAt = input.startsAt !== undefined ? input.startsAt : row.startsAt ?? null;
    const nextEndsAt = input.endsAt !== undefined ? input.endsAt : row.endsAt ?? null;
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      this.assertDateSanity(nextStartsAt, nextEndsAt, false);
    }

    let mutated = false;
    if (input.name !== undefined && input.name !== row.name) {
      row.name = input.name;
      mutated = true;
    }
    if (input.type !== undefined && input.type !== row.type) {
      row.type = input.type;
      mutated = true;
    }
    if (input.startsAt !== undefined) {
      row.startsAt = input.startsAt;
      mutated = true;
    }
    if (input.endsAt !== undefined) {
      row.endsAt = input.endsAt;
      mutated = true;
    }
    if (input.applicationRule !== undefined) {
      row.applicationRule = input.applicationRule;
      mutated = true;
    }
    if (mutated) {
      row.modifiedAt = new Date();
    }
    await em.flush();
    return row;
  }

  /**
   * Manual transition: draft → active (or scheduled / expired if dates
   * dictate). FR-009 row 1.
   */
  async activate(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id);
    const now = new Date();
    const next: PriceListStatus =
      row.startsAt && row.startsAt > now
        ? 'scheduled'
        : row.endsAt && row.endsAt < now
          ? 'expired'
          : 'active';
    if (row.status === next) return row;
    await this.assertCanTransitionStatus(id, next);
    row.status = next;
    row.modifiedAt = new Date();
    await em.flush();
    return row;
  }

  /**
   * Manual transition: any state → draft. Freezes the list immediately.
   */
  async draftify(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const row = await this.getById(id);
    if (row.status === 'draft') return row;
    await this.assertCanTransitionStatus(id, 'draft');
    row.status = 'draft';
    row.modifiedAt = new Date();
    await em.flush();
    return row;
  }

  /**
   * Duplicate a price list. Copies the rule, the assigned products, and
   * every bracket row. Resets status to `draft`, clears dates, and derives
   * a unique name (suffix ` (copy)`, ` (copy 2)`, …) — FR-013.
   */
  async duplicate(id: string): Promise<PriceList> {
    const em = this.emFactory();
    const source = await this.getById(id);

    const baseName = source.name;
    const candidates = await em.find(
      PriceList,
      { name: { $like: `${baseName} (copy%` } },
      { fields: ['id', 'name'] },
    );
    let suffix = ' (copy)';
    if (candidates.length > 0) {
      // Find the next available numeric suffix.
      let n = 2;
      while (candidates.some((c) => c.name === `${baseName} (copy ${n})`)) {
        n += 1;
      }
      // If the bare " (copy)" doesn't exist yet, use it.
      if (!candidates.some((c) => c.name === `${baseName} (copy)`)) {
        suffix = ' (copy)';
      } else {
        suffix = ` (copy ${n})`;
      }
    }
    const newName = `${baseName}${suffix}`;

    const dup = em.create(PriceList, {
      code: `pl-${randomUUID()}`,
      name: newName,
      currency: source.currency,
      isDefault: false,
      priority: 0,
      type: source.type,
      status: 'draft',
      startsAt: null,
      endsAt: null,
      applicationRule: structuredClone(source.applicationRule),
      isSystem: false,
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(dup);

    // Copy assignments first (FK target), then brackets.
    const products = await em.find(PriceListProduct, { priceListId: source.id });
    for (const p of products) {
      em.create(PriceListProduct, { priceListId: dup.id, productId: p.productId });
    }
    await em.flush();

    const brackets = await em.find(PriceListPriceBracket, { priceListId: source.id });
    for (const b of brackets) {
      em.create(PriceListPriceBracket, {
        priceListId: dup.id,
        productId: b.productId,
        currencyCode: b.currencyCode,
        minQuantity: b.minQuantity,
        maxQuantity: b.maxQuantity ?? null,
        amount: b.amount,
      });
    }
    await em.flush();

    return dup;
  }

  /**
   * Date sanity per FR-010: `endsAt` must be greater than `startsAt`; at
   * creation time `endsAt` must be in the future.
   */
  private assertDateSanity(
    startsAt: Date | null,
    endsAt: Date | null,
    onCreate: boolean,
  ): void {
    if (endsAt && startsAt && endsAt <= startsAt) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'endsAt must be greater than startsAt.',
      );
    }
    if (onCreate && endsAt && endsAt < new Date()) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'endsAt must be in the future at creation time.',
      );
    }
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
