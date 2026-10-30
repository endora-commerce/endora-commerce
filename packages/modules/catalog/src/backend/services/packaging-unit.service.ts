/**
 * PackagingUnitService — admin CRUD for product packaging units (feature 043).
 *
 * A packaging unit is a named ordering unit on a product (e.g. "Paleta" = 480
 * pieces). Units apply only to physical, purchasable product types
 * (simple / configurable). At most one unit per product is the default
 * presented on the storefront; setting a new default clears the previous one
 * (last write wins). Names are unique within a product. Hard delete is safe
 * because cart/order/RFQ lines snapshot their own copy.
 */

import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import {
  ERROR_CODES,
  isValidOrderMinimum,
  type CreatePackagingUnitRequest,
  type PackagingUnitDto,
  type ReorderPackagingUnitsRequest,
  type UpdatePackagingUnitRequest,
} from '@endora-commerce/contracts';

import { HttpError } from '@endora-commerce/platform/http';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { Product } from '../entities/product.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';

const ELIGIBLE_TYPES = new Set(['simple', 'configurable']);

interface PackagingWrite<T> {
  result: T;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Feature 163 — the write changed nothing: no audit row, no event. */
  unchanged?: boolean;
}

export class PackagingUnitService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits packaging-unit writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

  /**
   * Feature 054 — run a write through the Command Bus (co-transactional audit).
   *
   * Feature 163 (FR-080, FR-082) — with `announceFor` (the product id) a write that
   * changed something also emits `product.updated.v1` `['packagingUnits']` after commit
   * and its `after` carries `changedFields`; an `unchanged` write records no audit row.
   */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<PackagingWrite<T>>,
    announceFor?: string,
  ): Promise<T> {
    const command: Command<{ value: T; changed: boolean }> = {
      action,
      objectType: 'packaging_unit',
      objectId,
      run: async ({ em }) => {
        const w = await write(em);
        if (w.unchanged) return { result: { value: w.result, changed: false }, skipAudit: true };
        return {
          result: { value: w.result, changed: true },
          before: w.before,
          after: announceFor && w.after ? { ...w.after, changedFields: ['packagingUnits'] } : w.after,
        };
      },
      event: ({ changed }) =>
        announceFor && changed
          ? {
              eventName: 'product.updated.v1',
              payload: {
                eventId: randomUUID(),
                occurredAt: new Date().toISOString(),
                productId: announceFor,
                changedFields: ['packagingUnits'],
              },
            }
          : undefined,
    };
    if (this.commandBus) return (await this.commandBus.run(command)).value;
    const em = this.emFactory();
    const outcome = await command.run({
      em,
      actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
    });
    await em.flush();
    return outcome.result.value;
  }

  async list(productId: string): Promise<PackagingUnitDto[]> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
    const items = await em.find(
      ProductPackagingUnit,
      { productId },
      { orderBy: { position: 'asc', name: 'asc' } },
    );
    return items.map((i) => this.#dto(i));
  }

  async create(
    productId: string,
    req: CreatePackagingUnitRequest,
  ): Promise<PackagingUnitDto> {
    assertMinOrderUnits(req.minOrderUnits);
    const id = randomUUID();
    const unit = await this.#audited('packaging_unit.create', id, async (em) => {
      await this.#assertProductEligible(em, productId);
      const position = req.position ?? (await this.#nextPosition(em, productId));
      const u = em.create(ProductPackagingUnit, {
        id,
        productId,
        name: req.name.trim(),
        baseQuantity: req.baseQuantity,
        position,
        isDefault: req.isDefault ?? false,
        minOrderUnits: req.minOrderUnits ?? null,
        // Feature 163 (FR-079) — the name per language.
      });
      try {
        await em.flush();
      } catch (err) {
        throw this.#mapUniqueViolation(err, u.name);
      }
      if (u.isDefault) await this.#clearOtherDefaults(em, productId, u.id);
      return { result: u, before: null, after: unitProjection(u) };
    }, productId);
    return this.#dto(unit);
  }

  async update(
    productId: string,
    unitId: string,
    req: UpdatePackagingUnitRequest,
  ): Promise<PackagingUnitDto> {
    assertMinOrderUnits(req.minOrderUnits);
    const unit = await this.#audited('packaging_unit.update', unitId, async (em) => {
      const u = await this.#findOwned(em, productId, unitId);
      const before = unitProjection(u);
      if (req.name !== undefined) u.name = req.name.trim();
      if (req.baseQuantity !== undefined) u.baseQuantity = req.baseQuantity;
      if (req.position !== undefined) u.position = req.position;
      if (req.isDefault !== undefined) u.isDefault = req.isDefault;
      if (req.minOrderUnits !== undefined) u.minOrderUnits = req.minOrderUnits;
      const after = unitProjection(u);
      // A request that changes nothing writes and announces nothing (FR-080).
      if (JSON.stringify(before) === JSON.stringify(after) && req.position === undefined) {
        return { result: u, before, after, unchanged: true };
      }
      try {
        await em.flush();
      } catch (err) {
        throw this.#mapUniqueViolation(err, u.name);
      }
      if (req.isDefault === true) await this.#clearOtherDefaults(em, productId, u.id);
      return { result: u, before, after };
    }, productId);
    return this.#dto(unit);
  }

  async delete(productId: string, unitId: string): Promise<void> {
    await this.#audited('packaging_unit.delete', unitId, async (em) => {
      const unit = await this.#findOwned(em, productId, unitId);
      const before = { productId, name: unit.name };
      em.remove(unit);
      return { result: undefined, before, after: null };
    });
  }

  async reorder(
    productId: string,
    req: ReorderPackagingUnitsRequest,
  ): Promise<PackagingUnitDto[]> {
    await this.#audited('packaging_unit.reorder', productId, async (em) => {
      await this.#assertProductExists(em, productId);
      const items = await em.find(ProductPackagingUnit, { productId });
      const byId = new Map(items.map((i) => [i.id, i]));
      let position = 0;
      for (const id of req.orderedIds) {
        const unit = byId.get(id);
        if (!unit) {
          throw new HttpError(
            404,
            ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
            `Packaging unit ${id} not found under Product ${productId}.`,
          );
        }
        unit.position = position++;
      }
      return { result: undefined, before: null, after: { productId, count: req.orderedIds.length } };
    });
    return this.list(productId);
  }

  // -- INTERNALS ------------------------------------------------------------

  async #assertProductExists(em: EntityManager, productId: string): Promise<Product> {
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product ${productId} not found.`,
      );
    }
    return product;
  }

  async #assertProductEligible(em: EntityManager, productId: string): Promise<void> {
    const product = await this.#assertProductExists(em, productId);
    if (!ELIGIBLE_TYPES.has(product.type)) {
      throw new HttpError(
        422,
        ERROR_CODES.PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE,
        `Packaging units are only supported for simple or configurable products; got "${product.type}".`,
      );
    }
  }

  async #findOwned(
    em: EntityManager,
    productId: string,
    unitId: string,
  ): Promise<ProductPackagingUnit> {
    const unit = await em.findOne(ProductPackagingUnit, { id: unitId, productId });
    if (!unit) {
      throw new HttpError(
        404,
        ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
        `Packaging unit ${unitId} not found under Product ${productId}.`,
      );
    }
    return unit;
  }

  /** Clear `isDefault` on every other unit of the product (last write wins). */
  async #clearOtherDefaults(
    em: EntityManager,
    productId: string,
    keepId: string,
  ): Promise<void> {
    const others = await em.find(ProductPackagingUnit, {
      productId,
      isDefault: true,
      id: { $ne: keepId },
    });
    if (others.length === 0) return;
    // No flush here — the enclosing #audited command (or its bus-less fallback)
    // commits these together with the create/update.
    for (const o of others) o.isDefault = false;
  }

  /**
   * `em.execute`, not `em.getConnection().execute`: `create` calls this on the
   * Command's `em`, so the next free position is computed from the rows that
   * transaction can see rather than from a pooled connection's older view
   * (issue #207).
   */
  async #nextPosition(em: EntityManager, productId: string): Promise<number> {
    const rows = (await em.execute(
      `select coalesce(max(position), -1) + 1 as next_position from product_packaging_units where product_id = ?`,
      [productId],
    )) as Array<{ next_position: number }>;
    return rows[0]?.next_position ?? 0;
  }

  #mapUniqueViolation(err: unknown, name: string): unknown {
    if (err instanceof UniqueConstraintViolationException) {
      return new HttpError(
        409,
        ERROR_CODES.PACKAGING_UNIT_NAME_CONFLICT,
        `A packaging unit named "${name}" already exists for this product.`,
      );
    }
    return err;
  }

  #dto(u: ProductPackagingUnit): PackagingUnitDto {
    return {
      id: u.id,
      productId: u.productId,
      name: u.name,
      baseQuantity: u.baseQuantity,
      position: u.position,
      isDefault: u.isDefault,
      minOrderUnits: u.minOrderUnits ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}

/**
 * The audit projection of one packaging-unit write (FR-080): the product and every field
 * the PATCH accepts but `position` (the reorder's), so re-sending it (minus
 * `productId`) restores the unit (FR-081).
 */
function unitProjection(u: ProductPackagingUnit): Record<string, unknown> {
  return {
    productId: u.productId,
    name: u.name,
    baseQuantity: u.baseQuantity,
    isDefault: u.isDefault,
    minOrderUnits: u.minOrderUnits ?? null,
  };
}

/**
 * Feature 155 (FR-002, threat F5) — `minOrderUnits` is an integer in
 * 1…1 000 000 or `null` (clear). Checked here as well as in the route schema
 * because `CatalogPackagingPort` callers such as `pim_pimcore` reach this
 * service with no schema in front of it.
 */
function assertMinOrderUnits(value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!isValidOrderMinimum(value)) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The minimum number of packaging units must be a whole number from 1 to 1000000.',
      { field: 'minOrderUnits' },
    );
  }
}
