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

import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import {
  ERROR_CODES,
  type CreatePackagingUnitRequest,
  type PackagingUnitDto,
  type ReorderPackagingUnitsRequest,
  type UpdatePackagingUnitRequest,
} from '@b2b/contracts';

import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../entities/product.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';

const ELIGIBLE_TYPES = new Set(['simple', 'configurable']);

export class PackagingUnitService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
    const em = this.emFactory();
    await this.#assertProductEligible(em, productId);

    const position = req.position ?? (await this.#nextPosition(em, productId));
    const unit = em.create(ProductPackagingUnit, {
      productId,
      name: req.name.trim(),
      baseQuantity: req.baseQuantity,
      position,
      isDefault: req.isDefault ?? false,
    });
    try {
      await em.persistAndFlush(unit);
    } catch (err) {
      throw this.#mapUniqueViolation(err, unit.name);
    }
    if (unit.isDefault) await this.#clearOtherDefaults(em, productId, unit.id);
    return this.#dto(unit);
  }

  async update(
    productId: string,
    unitId: string,
    req: UpdatePackagingUnitRequest,
  ): Promise<PackagingUnitDto> {
    const em = this.emFactory();
    const unit = await this.#findOwned(em, productId, unitId);
    if (req.name !== undefined) unit.name = req.name.trim();
    if (req.baseQuantity !== undefined) unit.baseQuantity = req.baseQuantity;
    if (req.position !== undefined) unit.position = req.position;
    if (req.isDefault !== undefined) unit.isDefault = req.isDefault;
    try {
      await em.flush();
    } catch (err) {
      throw this.#mapUniqueViolation(err, unit.name);
    }
    if (req.isDefault === true) await this.#clearOtherDefaults(em, productId, unit.id);
    return this.#dto(unit);
  }

  async delete(productId: string, unitId: string): Promise<void> {
    const em = this.emFactory();
    const unit = await this.#findOwned(em, productId, unitId);
    await em.removeAndFlush(unit);
  }

  async reorder(
    productId: string,
    req: ReorderPackagingUnitsRequest,
  ): Promise<PackagingUnitDto[]> {
    const em = this.emFactory();
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
    await em.flush();
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
    for (const o of others) o.isDefault = false;
    await em.flush();
  }

  async #nextPosition(em: EntityManager, productId: string): Promise<number> {
    const conn = em.getConnection();
    const rows = (await conn.execute(
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
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
