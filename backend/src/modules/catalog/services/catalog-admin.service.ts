import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type ApiAttributeType,
  type AttributeValueType,
  type CreateAttributeRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type NumericKind,
  type UpdateAttributeRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';

export interface CatalogEvents extends Record<string, EventBase> {
  'product.created.v1': EventBase & { productId: string; sku: string };
  'product.updated.v1': EventBase & { productId: string; changedFields: string[] };
  'product.archived.v1': EventBase & { productId: string };
  'product.deleted.v1': EventBase & { productId: string };
  'attribute.updated.v1': EventBase & {
    attributeKey: string;
    isSearchable: boolean;
    isFilterable: boolean;
  };
}

export type CatalogEventBus = EventBus<CatalogEvents>;
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../entities/product.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import {
  assertVirtualDownloadFields,
  ProductTypeValidationError,
} from './product-type-validations.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';

/** Optional metadata used to attach audit entries to admin mutations. */
export interface AdminAuditContext {
  actorAdminUserId: string;
  impersonatedCustomerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Catalog write-path service (admin write surface).
 * Every mutation emits a typed event on the shared bus so the search indexer
 * (T067) and webhook bridge (Phase 2 T037) can react.
 */

export class CatalogAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: CatalogEventBus,
    private readonly auditLog?: AuditLogService,
    /**
     * Feature 005 / T027 — when injected, every newly-created Product
     * that does not declare explicit channel membership lands in the
     * system-default Sales Channel automatically (FR-011). Optional so
     * existing tests that construct this service without sales-channels
     * keep compiling; production composition.ts always provides it.
     */
    private readonly salesChannelMembership?: SalesChannelMembershipService,
  ) {}

  async createProduct(
    req: CreateProductRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<Product> {
    const em = this.emFactory();
    // Feature 002 (T047): cross-field validation for virtual download
    // fields. Zod's .refine() catches most cases at the boundary; the
    // service-level guard is the belt-and-braces backstop for any
    // call path that bypasses the schema (e.g. internal seeding).
    try {
      assertVirtualDownloadFields({
        type: req.type,
        downloadAssetId: req.downloadAssetId ?? null,
        downloadUrl: req.downloadUrl ?? null,
      });
    } catch (err) {
      if (err instanceof ProductTypeValidationError) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, err.message);
      }
      throw err;
    }
    const slug = this.slugify(this.anyValue(req.name) || req.sku);
    const product = em.create(Product, {
      sku: req.sku,
      slug,
      type: req.type,
      status: 'draft',
      name: req.name,
      description: req.description,
      stockMode: req.stockMode ?? null,
      visibility: req.visibility,
      attributeValues: req.attributeValues as Record<string, unknown>,
      allowedOrganizationIds: req.allowedOrganizationIds ?? [],
      // Feature 002 (T034): use the requested AttributeSet, else fall
      // back to the entity's compile-time default (system Default Set).
      ...(req.attributeSetId ? { attributeSetId: req.attributeSetId } : {}),
      // Feature 002 (T047): persist virtual download fields when set.
      ...(req.downloadAssetId !== undefined
        ? { downloadAssetId: req.downloadAssetId }
        : {}),
      ...(req.downloadUrl !== undefined ? { downloadUrl: req.downloadUrl } : {}),
    });
    // Feature 002 (T023): the keys in `attributeValues` MUST belong to
    // the Product's AttributeSet. The entity defaults `attributeSetId`
    // to the system Default Set; future API surface revisions will let
    // the admin pick a custom Set explicitly. See data-model.md §1.1.
    await this.assertAttributeValueKeysAllowed(
      em,
      product.attributeSetId,
      req.attributeValues as Record<string, unknown>,
    );
    try {
      await em.persistAndFlush(product);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(409, ERROR_CODES.SKU_ALREADY_EXISTS, `SKU "${req.sku}" already exists.`);
      }
      throw err;
    }

    // Feature 005 / FR-011 — bind to Default unless this product was
    // already given memberships through some other path.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('product', product.id);
    }

    this.events.emit('product.created.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: product.id,
      sku: product.sku,
    });
    // Feature 024 — audit `product.create` so the dashboard's Recent
    // Activity card surfaces newly-created products. Fires after the
    // entity is committed; rolled-back creates therefore never produce
    // an audit row.
    if (this.auditLog && auditCtx) {
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'product.create',
        objectType: 'product',
        objectId: product.id,
        stateAfter: {
          sku: product.sku,
          name: { ...product.name },
          status: product.status,
          visibility: product.visibility,
          stockMode: product.stockMode,
        },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }
    return product;
  }

  async updateProduct(
    id: string,
    req: UpdateProductRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<Product> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const stateBefore: Record<string, unknown> = {
      sku: product.sku,
      name: { ...product.name },
      description: { ...product.description },
      stockMode: product.stockMode,
      visibility: product.visibility,
      status: product.status,
      archivedAt: product.archivedAt ?? null,
      attributeValues: { ...product.attributeValues },
      allowedOrganizationIds: [...product.allowedOrganizationIds],
    };
    const changedFields: string[] = [];
    // Feature 012 / FR-016 — SKU is mutable. Refused with 400 sku_in_use
    // when the new SKU collides with another product. The internal UUID
    // (product.id) is the canonical reference; snapshot tables keep the
    // SKU value frozen at snapshot time so historical orders / RFQs /
    // invoices stay stable.
    if (req.sku !== undefined && req.sku.trim() !== product.sku) {
      const trimmed = req.sku.trim();
      if (trimmed.length === 0 || trimmed.length > 160) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'invalid_sku',
        );
      }
      const conflict = await em.findOne(Product, { sku: trimmed });
      if (conflict && conflict.id !== product.id) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `sku_in_use { conflictingProductId: ${conflict.id}, conflictingSku: ${trimmed} }`,
        );
      }
      // Feature 025 — SKUs share a global namespace with variants (see createVariant).
      const variantConflict = await em.findOne(ProductVariant, { sku: trimmed });
      if (variantConflict) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `sku_in_use { conflictingVariantId: ${variantConflict.id}, conflictingSku: ${trimmed} }`,
        );
      }
      product.sku = trimmed;
      changedFields.push('sku');
    }
    if (req.name) { product.name = req.name; changedFields.push('name'); }
    if (req.description) { product.description = req.description; changedFields.push('description'); }
    if (req.stockMode !== undefined) { product.stockMode = req.stockMode; changedFields.push('stockMode'); }
    if (req.visibility) { product.visibility = req.visibility; changedFields.push('visibility'); }
    // Feature 022 / 032 — status field. Cross-field rule: transitioning to
    // `inactive` sets archivedAt; transitioning away clears it.
    if (req.status !== undefined && req.status !== product.status) {
      product.status = req.status;
      if (req.status === 'inactive') {
        product.archivedAt = new Date();
      } else {
        product.archivedAt = null;
      }
      changedFields.push('status');
    }
    // Feature 002 (T034) — attribute_set_id swap. Persist BEFORE
    // attribute_values so the validation sees the new set's allowed keys.
    if (req.attributeSetId !== undefined && req.attributeSetId !== product.attributeSetId) {
      product.attributeSetId = req.attributeSetId;
      changedFields.push('attributeSetId');
    }
    if (req.attributeValues) {
      // Feature 002 (T023) — validate the patched keys against the
      // Product's current AttributeSet. The merged object keys are all
      // valid as long as both pre-existing and incoming keys live in
      // the set; we validate the incoming patch only since the existing
      // values were already validated at their time of write.
      await this.assertAttributeValueKeysAllowed(
        em,
        product.attributeSetId,
        req.attributeValues as Record<string, unknown>,
      );
      product.attributeValues = { ...product.attributeValues, ...req.attributeValues };
      changedFields.push('attributeValues');
    }
    // Feature 012 / FR-013 — refuse the save if any required attribute
    // in the assigned set is left without a value. The merged map is
    // the source of truth here (a previously-set value satisfies the
    // requirement even when the current patch omits it).
    if (
      product.attributeSetId &&
      (req.attributeValues !== undefined ||
        req.attributeSetId !== undefined)
    ) {
      await this.assertRequiredAttributesPresent(
        em,
        product.attributeSetId,
        product.attributeValues ?? {},
      );
    }
    if (req.allowedOrganizationIds) {
      product.allowedOrganizationIds = req.allowedOrganizationIds;
      changedFields.push('allowedOrganizationIds');
    }
    // Feature 022 — category membership writes. `categoryIds` is the
    // canonical set; rows are diffed against the current `product_categories`
    // bridge and only added/removed rows are touched. Callers wanting
    // `add` (union) semantics compute the union before passing it in
    // (see CatalogBulkUpdateService).
    if (req.categoryIds !== undefined) {
      const conn = em.getConnection();
      const txCtx = em.getTransactionContext();
      const currentRows = (await conn.execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ?`,
        [product.id],
        'all',
        txCtx,
      )) as Array<{ category_id: string }>;
      const current = new Set(currentRows.map((r) => r.category_id));
      const target = new Set(req.categoryIds);
      const toAdd = req.categoryIds.filter((id) => !current.has(id));
      const toRemove = [...current].filter((id) => !target.has(id));
      if (toRemove.length > 0) {
        const placeholders = toRemove.map(() => '?').join(',');
        await conn.execute(
          `delete from product_categories where product_id = ? and category_id in (${placeholders})`,
          [product.id, ...toRemove],
          'run',
          txCtx,
        );
      }
      if (toAdd.length > 0) {
        const placeholders = toAdd.map(() => '(?,?)').join(',');
        const params: unknown[] = [];
        for (const cid of toAdd) {
          params.push(product.id, cid);
        }
        await conn.execute(
          `insert into product_categories (product_id, category_id) values ${placeholders}`,
          params,
          'run',
          txCtx,
        );
      }
      if (toAdd.length > 0 || toRemove.length > 0) {
        changedFields.push('categoryIds');
      }
    }
    // Feature 010 — per-product stock-management flags.
    if (req.manageStock !== undefined) {
      product.manageStock = req.manageStock;
      changedFields.push('manageStock');
    }
    if (req.backorderEnabled !== undefined) {
      product.backorderEnabled = req.backorderEnabled;
      changedFields.push('backorderEnabled');
    }
    if (req.lowStockThreshold !== undefined) {
      product.lowStockThreshold = req.lowStockThreshold;
      changedFields.push('lowStockThreshold');
    }
    if (req.lowStockThresholdMode !== undefined) {
      product.lowStockThresholdMode = req.lowStockThresholdMode;
      changedFields.push('lowStockThresholdMode');
    }
    if (req.fulfilmentStrategy !== undefined) {
      product.fulfilmentStrategy = req.fulfilmentStrategy;
      changedFields.push('fulfilmentStrategy');
    }
    if (req.fulfilmentStrategyWarehouseOrder !== undefined) {
      product.fulfilmentStrategyWarehouseOrder = req.fulfilmentStrategyWarehouseOrder;
      changedFields.push('fulfilmentStrategyWarehouseOrder');
    }
    await em.flush();

    if (this.auditLog && auditCtx) {
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'product.update',
        objectType: 'product',
        objectId: product.id,
        stateBefore,
        stateAfter: {
          name: { ...product.name },
          description: { ...product.description },
          stockMode: product.stockMode,
          visibility: product.visibility,
          status: product.status,
          archivedAt: product.archivedAt ?? null,
          attributeValues: { ...product.attributeValues },
          allowedOrganizationIds: [...product.allowedOrganizationIds],
          changedFields,
        },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }

    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: product.id,
      changedFields,
    });
    return product;
  }

  /**
   * Duplicate an existing Product: copies the core row plus bridge tables
   * (categories, sales-channel memberships, gallery items + labels,
   * attachments, related/up-sell/cross-sell links, grouped children,
   * bundle slots + options, variants).
   *
   * The duplicated row gets a fresh UUID; the SKU is derived from the
   * source by appending `-copy`, then `-copy-2`, `-copy-3`, … until a
   * free slot is found. Status is reset to `'draft'` and `archivedAt`
   * is cleared so the operator can review before publishing.
   *
   * Variants have their own globally-unique SKUs; each is suffixed in
   * the same way against the variant SKU space.
   */
  async duplicateProduct(id: string): Promise<Product> {
    const em = this.emFactory();
    const source = await em.findOne(Product, { id });
    if (!source) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const newSku = await this.allocateCopySku(em, source.sku);
    const newSlug = await this.allocateCopySlug(em, source.slug);

    const dup = em.create(Product, {
      sku: newSku,
      slug: newSlug,
      type: source.type,
      status: 'draft',
      name: this.suffixCopyNames(source.name),
      description: { ...source.description },
      stockMode: source.stockMode ?? null,
      visibility: source.visibility,
      attributeValues: { ...source.attributeValues },
      allowedOrganizationIds: [...source.allowedOrganizationIds],
      attributeSetId: source.attributeSetId,
      ...(source.downloadAssetId !== undefined && source.downloadAssetId !== null
        ? { downloadAssetId: source.downloadAssetId }
        : {}),
      ...(source.downloadUrl !== undefined && source.downloadUrl !== null
        ? { downloadUrl: source.downloadUrl }
        : {}),
      manageStock: source.manageStock,
      backorderEnabled: source.backorderEnabled,
      ...(source.lowStockThreshold !== undefined && source.lowStockThreshold !== null
        ? { lowStockThreshold: source.lowStockThreshold }
        : {}),
      lowStockThresholdMode: source.lowStockThresholdMode,
      ...(source.fulfilmentStrategy !== undefined && source.fulfilmentStrategy !== null
        ? { fulfilmentStrategy: source.fulfilmentStrategy }
        : {}),
      ...(source.fulfilmentStrategyWarehouseOrder !== undefined &&
      source.fulfilmentStrategyWarehouseOrder !== null
        ? {
            fulfilmentStrategyWarehouseOrder: [
              ...source.fulfilmentStrategyWarehouseOrder,
            ],
          }
        : {}),
    });
    await em.persistAndFlush(dup);

    const conn = em.getConnection();

    // product_categories (bridge)
    await conn.execute(
      `insert into "product_categories" ("product_id", "category_id")
         select ?, "category_id" from "product_categories" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // sales_channel_products (bridge)
    await conn.execute(
      `insert into "sales_channel_products" ("sales_channel_id", "product_id")
         select "sales_channel_id", ? from "sales_channel_products" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // gallery_items + gallery_item_labels — we need a fresh UUID per item
    // and to rewrite the bridge rows to the new ids.
    const galleryRows = (await conn.execute(
      `select "id", "asset_id", "position" from "gallery_items"
         where "product_id" = ? order by "position" asc`,
      [source.id],
    )) as Array<{ id: string; asset_id: string; position: number }>;
    if (galleryRows.length > 0) {
      const idMap = new Map<string, string>();
      for (const row of galleryRows) {
        const newId = randomUUID();
        idMap.set(row.id, newId);
        await conn.execute(
          `insert into "gallery_items"
             ("id", "product_id", "asset_id", "position", "created_at", "updated_at")
             values (?, ?, ?, ?, now(), now())`,
          [newId, dup.id, row.asset_id, row.position],
        );
      }
      const labelRows = (await conn.execute(
        `select "gallery_item_id", "label" from "gallery_item_labels"
           where "product_id" = ?`,
        [source.id],
      )) as Array<{ gallery_item_id: string; label: string }>;
      for (const lbl of labelRows) {
        const mapped = idMap.get(lbl.gallery_item_id);
        if (!mapped) continue;
        await conn.execute(
          `insert into "gallery_item_labels"
             ("gallery_item_id", "product_id", "label") values (?, ?, ?)`,
          [mapped, dup.id, lbl.label],
        );
      }
    }

    // product_attachments
    await conn.execute(
      `insert into "product_attachments"
         ("id", "product_id", "asset_id", "attachment_type_id", "name", "description", "position", "created_at", "updated_at")
         select gen_random_uuid(), ?, "asset_id", "attachment_type_id", "name", "description", "position", now(), now()
           from "product_attachments" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // product_links (only outgoing links are copied — incoming links from
    // other products toward the source product stay attached to the source)
    await conn.execute(
      `insert into "product_links"
         ("id", "source_product_id", "target_product_id", "kind", "position", "created_at", "updated_at")
         select gen_random_uuid(), ?, "target_product_id", "kind", "position", now(), now()
           from "product_links" where "source_product_id" = ?`,
      [dup.id, source.id],
    );

    // grouped_items (children of a grouped product)
    if (source.type === 'grouped') {
      await conn.execute(
        `insert into "grouped_items"
           ("id", "parent_product_id", "child_product_id", "quantity", "position", "created_at", "updated_at")
           select gen_random_uuid(), ?, "child_product_id", "quantity", "position", now(), now()
             from "grouped_items" where "parent_product_id" = ?`,
        [dup.id, source.id],
      );
    }

    // bundle_slots + bundle_slot_options
    if (source.type === 'bundle') {
      const slotRows = (await conn.execute(
        `select "id", "name", "min_quantity", "max_quantity", "position"
           from "bundle_slots" where "parent_product_id" = ?`,
        [source.id],
      )) as Array<{
        id: string;
        name: unknown;
        min_quantity: number;
        max_quantity: number;
        position: number;
      }>;
      for (const slot of slotRows) {
        const newSlotId = randomUUID();
        await conn.execute(
          `insert into "bundle_slots"
             ("id", "parent_product_id", "name", "min_quantity", "max_quantity", "position", "created_at", "updated_at")
             values (?, ?, ?::jsonb, ?, ?, ?, now(), now())`,
          [
            newSlotId,
            dup.id,
            JSON.stringify(slot.name),
            slot.min_quantity,
            slot.max_quantity,
            slot.position,
          ],
        );
        await conn.execute(
          `insert into "bundle_slot_options"
             ("id", "slot_id", "option_product_id", "default_quantity", "position", "created_at", "updated_at")
             select gen_random_uuid(), ?, "option_product_id", "default_quantity", "position", now(), now()
               from "bundle_slot_options" where "slot_id" = ?`,
          [newSlotId, slot.id],
        );
      }
    }

    // product_warehouse_low_stock_thresholds — per-(product, warehouse)
    // low-stock thresholds. Carry these over so duplicates inherit the
    // same per-warehouse alerting profile.
    await conn.execute(
      `insert into "product_warehouse_low_stock_thresholds"
         ("product_id", "warehouse_id", "threshold", "created_at", "updated_at")
         select ?, "warehouse_id", "threshold", now(), now()
           from "product_warehouse_low_stock_thresholds" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // product_variants (configurable products) — each variant has its own
    // unique SKU; we allocate copies the same way as the parent SKU.
    if (source.type === 'configurable') {
      const variants = await em.find(ProductVariant, { parentProductId: source.id });
      for (const v of variants) {
        const variantSku = await this.allocateCopySku(em, v.sku);
        const newVariant = em.create(ProductVariant, {
          parentProductId: dup.id,
          sku: variantSku,
          variantAttributeValues: { ...v.variantAttributeValues },
          ...(v.priceOverride != null ? { priceOverride: v.priceOverride } : {}),
          ...(v.stockLevel != null ? { stockLevel: v.stockLevel } : {}),
        });
        em.persist(newVariant);
      }
      await em.flush();
    }

    this.events.emit('product.created.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: dup.id,
      sku: dup.sku,
    });

    return dup;
  }

  /**
   * Find a free SKU derived from `baseSku` by appending `-copy`,
   * `-copy-2`, `-copy-3`, … until both Product and ProductVariant tables
   * are clear (SKUs share a global namespace per `createVariant`).
   * Bounded by 1000 attempts so a pathological collision can't hang.
   */
  private async allocateCopySku(em: EntityManager, baseSku: string): Promise<string> {
    const root = `${baseSku}-copy`;
    for (let i = 0; i < 1000; i += 1) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const trimmed = candidate.slice(0, 64);
      const productHit = await em.findOne(Product, { sku: trimmed });
      if (productHit) continue;
      const variantHit = await em.findOne(ProductVariant, { sku: trimmed });
      if (variantHit) continue;
      return trimmed;
    }
    throw new HttpError(
      409,
      ERROR_CODES.SKU_ALREADY_EXISTS,
      `Could not allocate a unique SKU derived from "${baseSku}".`,
    );
  }

  private async allocateCopySlug(em: EntityManager, baseSlug: string): Promise<string> {
    const root = this.slugify(`${baseSlug}-copy`);
    for (let i = 0; i < 1000; i += 1) {
      const candidate = i === 0 ? root : this.slugify(`${root}-${i + 1}`);
      const hit = await em.findOne(Product, { slug: candidate });
      if (!hit) return candidate;
    }
    throw new HttpError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      `Could not allocate a unique slug derived from "${baseSlug}".`,
    );
  }

  /**
   * Multilingual `name`: tag every locale with a "(copy)" suffix so the
   * duplicated product is obviously a clone in lists. Empty locales are
   * left untouched.
   */
  private suffixCopyNames(name: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [locale, value] of Object.entries(name)) {
      if (!value || value.trim() === '') {
        out[locale] = value;
      } else {
        out[locale] = `${value} (copy)`.slice(0, 255);
      }
    }
    return out;
  }

  /**
   * @deprecated Use `updateProduct` with `status: 'inactive'` instead.
   * Kept for internal callers that still emit `product.archived.v1`.
   */
  async archiveProduct(id: string, auditCtx?: AdminAuditContext): Promise<void> {
    await this.updateProduct(id, { status: 'inactive' }, auditCtx);
    this.events.emit('product.archived.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: id,
    });
  }

  async assertProductDeletable(em: EntityManager, productId: string): Promise<void> {
    const knex = em.getKnex();
    const orderRow = (await knex('order_items')
      .where({ product_id: productId })
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    if (Number(orderRow?.count ?? 0) > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_DELETE_BLOCKED,
        'Product cannot be deleted because it is referenced by order lines.',
      );
    }
    const cartRow = (await knex('cart_items')
      .where({ product_id: productId })
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    if (Number(cartRow?.count ?? 0) > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_DELETE_BLOCKED,
        'Product cannot be deleted because it is referenced by cart lines.',
      );
    }
  }

  async deleteProduct(id: string, auditCtx?: AdminAuditContext): Promise<void> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id, deletedAt: null });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    await this.assertProductDeletable(em, id);
    const stateBefore = {
      status: product.status,
      sku: product.sku,
      name: { ...product.name },
      deletedAt: product.deletedAt ?? null,
    };
    product.deletedAt = new Date();
    await em.flush();
    this.events.emit('product.deleted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: product.id,
    });
    if (this.auditLog && auditCtx) {
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'product.delete',
        objectType: 'product',
        objectId: product.id,
        stateBefore,
        stateAfter: {
          ...stateBefore,
          deletedAt: product.deletedAt?.toISOString() ?? null,
        },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }
  }

  // ------------------------------------------------------------------
  // Attributes
  // ------------------------------------------------------------------

  async createAttribute(req: CreateAttributeRequest): Promise<ProductAttribute> {
    const em = this.emFactory();
    // Feature 002 T013/T021/T022 — resolve API `type` (or legacy
    // `valueType`) to the persisted `valueType` + `displayAsSlider`.
    const resolved = resolveAttributeApiType(req);
    if (
      resolved.displayAsSlider &&
      resolved.valueType !== 'number' &&
      resolved.valueType !== 'price'
    ) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `displayAsSlider is only valid for valueType="number" or "price"; got "${resolved.valueType}".`,
      );
    }
    const labelDefault =
      req.labelDefault ??
      req.label['en-US'] ??
      Object.values(req.label)[0] ??
      req.key;
    const attr = em.create(ProductAttribute, {
      key: req.key,
      label: req.label,
      labelDefault,
      valueType: resolved.valueType,
      isSearchable: req.isSearchable,
      isFilterable: req.isFilterable,
      isVariantAxis: req.isVariantAxis,
      displayAsSlider: resolved.displayAsSlider,
      isComparable: req.isComparable ?? false,
      isRequired: req.isRequired ?? false,
      isPromoRule: req.isPromoRule ?? false,
      filterPosition: req.filterPosition ?? 0,
      isVisibleOnProductPage: req.isVisibleOnProductPage ?? false,
      massEditable: req.massEditable ?? false,
    });
    try {
      await em.persistAndFlush(attr);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `Attribute key "${req.key}" already exists.`);
      }
      throw err;
    }
    // Feature 012 — when the operator supplies legacy `enumValues` OR the
    // new rich `options` array, materialise them as `attribute_options`
    // rows on the new table. The rich form wins when both are present.
    const inlineOptions = req.options;
    const legacyValues = req.enumValues;
    if (inlineOptions && inlineOptions.length > 0) {
      const { AttributeOption } = await import('../entities/attribute-option.entity.js');
      for (const [i, o] of inlineOptions.entries()) {
        em.create(AttributeOption, {
          attributeId: attr.id,
          value: o.value,
          label: o.label ?? {},
          labelDefault: o.labelDefault,
          isDefault: o.isDefault ?? false,
          sortOrder: o.sortOrder ?? i,
        });
      }
      await em.flush();
    } else if (legacyValues && legacyValues.length > 0) {
      const { AttributeOption } = await import('../entities/attribute-option.entity.js');
      for (const [i, v] of legacyValues.entries()) {
        em.create(AttributeOption, {
          attributeId: attr.id,
          value: v,
          label: {},
          labelDefault: v,
          isDefault: false,
          sortOrder: i,
        });
      }
      await em.flush();
    }
    this.events.emit('attribute.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      attributeKey: attr.key,
      isSearchable: attr.isSearchable,
      isFilterable: attr.isFilterable,
    });
    return attr;
  }

  async updateAttributeByIdOrKey(
    idOrKey: string,
    req: UpdateAttributeRequest,
  ): Promise<ProductAttribute> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    const em = this.emFactory();
    const attr = await em.findOne(
      ProductAttribute,
      isUuid ? { id: idOrKey } : { key: idOrKey },
    );
    if (!attr) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Attribute "${idOrKey}" not found.`,
      );
    }
    return this.applyAttributeUpdate(em, attr, req);
  }

  async updateAttribute(key: string, req: UpdateAttributeRequest): Promise<ProductAttribute> {
    const em = this.emFactory();
    const attr = await em.findOne(ProductAttribute, { key });
    if (!attr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${key}" not found.`);
    }
    return this.applyAttributeUpdate(em, attr, req);
  }

  private async applyAttributeUpdate(
    em: EntityManager,
    attr: ProductAttribute,
    req: UpdateAttributeRequest,
  ): Promise<ProductAttribute> {
    if (req.label !== undefined) attr.label = req.label;
    if (req.labelDefault !== undefined) attr.labelDefault = req.labelDefault;
    if (req.isSearchable !== undefined) attr.isSearchable = req.isSearchable;
    if (req.isFilterable !== undefined) attr.isFilterable = req.isFilterable;
    if (req.isVariantAxis !== undefined) attr.isVariantAxis = req.isVariantAxis;
    if (req.isComparable !== undefined) attr.isComparable = req.isComparable;
    if (req.isRequired !== undefined) attr.isRequired = req.isRequired;
    if (req.isPromoRule !== undefined) attr.isPromoRule = req.isPromoRule;
    if (req.filterPosition !== undefined) attr.filterPosition = req.filterPosition;
    if (req.isVisibleOnProductPage !== undefined) {
      attr.isVisibleOnProductPage = req.isVisibleOnProductPage;
    }
    if (req.massEditable !== undefined) {
      attr.massEditable = req.massEditable;
    }
    if (req.type !== undefined) {
      // Feature 002 — patching `type` re-derives valueType + displayAsSlider.
      const resolved = resolveAttributeApiType({
        type: req.type,
        ...(req.numericKind !== undefined ? { numericKind: req.numericKind } : {}),
        ...(req.displayAsSlider !== undefined
          ? { displayAsSlider: req.displayAsSlider }
          : {}),
      });
      attr.valueType = resolved.valueType;
      attr.displayAsSlider = resolved.displayAsSlider;
    } else if (req.displayAsSlider !== undefined) {
      // Same valueType-vs-displayAsSlider rule as createAttribute.
      if (
        req.displayAsSlider &&
        attr.valueType !== 'number' &&
        attr.valueType !== 'price'
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `displayAsSlider is only valid for valueType="number" or "price"; got "${attr.valueType}".`,
        );
      }
      attr.displayAsSlider = req.displayAsSlider;
    }
    await em.flush();
    this.events.emit('attribute.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      attributeKey: attr.key,
      isSearchable: attr.isSearchable,
      isFilterable: attr.isFilterable,
    });
    return attr;
  }

  // --- Read methods (admin lists / detail) --------------------------------

  async listProducts(
    options: {
      includeArchived?: boolean;
      status?: 'active' | 'draft' | 'inactive';
      type?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{
    items: Product[];
    page: number;
    pageSize: number;
    total: number;
    counts: { all: number; active: number; draft: number; inactive: number };
  }> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 500);

    // `status` overrides `includeArchived` — if the caller explicitly asks for
    // a specific status (including `inactive`), we honour it; otherwise the
    // legacy `includeArchived` flag controls whether inactive rows appear.
    const where: Record<string, unknown> = { deletedAt: null };
    if (options.status) {
      where['status'] = options.status;
    } else if (!options.includeArchived) {
      where['status'] = { $ne: 'inactive' };
    }
    if (options.type) {
      where['type'] = options.type;
    }

    let items: Product[];
    let total: number;
    const trimmedQ = options.q?.trim();
    if (trimmedQ) {
      // Text search: case-insensitive substring on SKU, slug, and any value
      // in the localized `name` JSON column. The JSON filter uses a raw
      // `LOWER("name"::text) LIKE ?` because MikroORM's structured operators
      // don't reach into JSON columns. We page via knex to keep the SQL
      // single-statement, then re-hydrate Product entities by id.
      const knex = em.getKnex();
      const needle = `%${trimmedQ.toLowerCase()}%`;
      const baseQuery = knex('products').where((qb) => {
        qb.whereNull('deleted_at');
        if (options.status) qb.where('status', options.status);
        else if (!options.includeArchived) qb.whereNot('status', 'inactive');
        if (options.type) qb.where('type', options.type);
        qb.andWhere((inner) => {
          inner
            .whereRaw('LOWER("sku") LIKE ?', [needle])
            .orWhereRaw('LOWER("slug") LIKE ?', [needle])
            .orWhereRaw('LOWER("name"::text) LIKE ?', [needle]);
        });
      });
      const totalRow = (await baseQuery.clone().count<{ count: string | number }>('* as count').first()) as
        | { count: string | number }
        | undefined;
      total = Number(totalRow?.count ?? 0);
      const idRows = (await baseQuery
        .clone()
        .orderBy('created_at', 'desc')
        .offset(page * pageSize)
        .limit(pageSize)
        .select<Array<{ id: string }>>('id')) as Array<{ id: string }>;
      const ids = idRows.map((r) => r.id);
      if (ids.length === 0) {
        items = [];
      } else {
        const found = await em.find(Product, { id: { $in: ids } });
        // Preserve the SQL ordering (created_at DESC) — `find` returns rows
        // in arbitrary order when filtering by `$in`.
        const byId = new Map(found.map((p) => [p.id, p]));
        items = ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
      }
    } else {
      [items, total] = await em.findAndCount(Product, where, {
        orderBy: { createdAt: 'desc' },
        offset: page * pageSize,
        limit: pageSize,
      });
    }

    // Counts are computed across the *full* product set (including archived)
    // so the admin's status tabs always have honest badges, regardless of
    // which tab is currently active.
    const knex = em.getKnex();
    const countRows = (await knex('products')
      .whereNull('deleted_at')
      .select('status')
      .count<{ status: string; count: string | number }[]>('* as count')
      .groupBy('status')) as Array<{ status: string; count: string | number }>;
    const counts = { all: 0, active: 0, draft: 0, inactive: 0 };
    for (const row of countRows) {
      const n = Number(row.count) || 0;
      counts.all += n;
      if (row.status === 'active') counts.active = n;
      else if (row.status === 'draft') counts.draft = n;
      else if (row.status === 'inactive') counts.inactive = n;
    }

    return { items, page, pageSize, total, counts };
  }

  async getProductById(id: string): Promise<Product> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id, deletedAt: null });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    return product;
  }

  /**
   * Batch-by-id read. Returns matching products for the given id set,
   * deduped server-side. Includes archived rows so callers can resolve
   * names for already-attached references (e.g. ProductEditor's link
   * tables) regardless of current status. Paginated for callers that
   * stream large id sets across multiple requests.
   */
  async listProductsByIds(input: {
    ids: string[];
    page?: number;
    pageSize?: number;
  }): Promise<{ items: Product[]; page: number; pageSize: number; total: number }> {
    const em = this.emFactory();
    const page = Math.max(0, input.page ?? 0);
    const pageSize = Math.min(Math.max(1, input.pageSize ?? 50), 500);
    const uniqueIds = Array.from(new Set(input.ids));
    if (uniqueIds.length === 0) {
      return { items: [], page, pageSize, total: 0 };
    }
    const [items, total] = await em.findAndCount(
      Product,
      { id: { $in: uniqueIds } },
      {
        orderBy: { createdAt: 'desc' },
        offset: page * pageSize,
        limit: pageSize,
      },
    );
    return { items, page, pageSize, total };
  }

  async listAttributes(): Promise<ProductAttribute[]> {
    const em = this.emFactory();
    return em.find(ProductAttribute, {}, { orderBy: { key: 'asc' } });
  }

  /**
   * Feature 012 — read every attribute carrying a given boolean flag.
   * Used by the Promotion Rule editor's criterion picker
   * (`flag = isPromoRule`) and the Compare-page column picker
   * (`flag = isComparable`). Other flags are surfaced for symmetry.
   */
  async listAttributesByFlag(
    flag:
      | 'isSearchable'
      | 'isFilterable'
      | 'isComparable'
      | 'isVariantAxis'
      | 'isPromoRule'
      | 'isVisibleOnProductPage'
      | 'isRequired'
      | 'isMassEditable',
  ): Promise<ProductAttribute[]> {
    const em = this.emFactory();
    // `isMassEditable` is exposed as a separate API flag name; the backing
    // entity field is `massEditable` (no `is` prefix). Map here.
    const entityFlag = flag === 'isMassEditable' ? 'massEditable' : flag;
    return em.find(
      ProductAttribute,
      { [entityFlag]: true } as Partial<ProductAttribute>,
      { orderBy: { key: 'asc' } },
    );
  }

  /**
   * Feature 012 / US4 — list every option for one attribute, ordered
   * by sortOrder ASC then value ASC.
   */
  async listAttributeOptions(
    attributeId: string,
  ): Promise<import('../entities/attribute-option.entity.js').AttributeOption[]> {
    const { AttributeOption } = await import('../entities/attribute-option.entity.js');
    const em = this.emFactory();
    return em.find(
      AttributeOption,
      { attributeId },
      { orderBy: { sortOrder: 'asc', value: 'asc' } },
    );
  }

  /** Feature 012 / US4 — append an option (validated cross-list). */
  async addAttributeOption(
    attributeIdOrKey: string,
    input: {
      value: string;
      label?: Record<string, string>;
      labelDefault: string;
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): Promise<import('../entities/attribute-option.entity.js').AttributeOption> {
    const { AttributeOption } = await import('../entities/attribute-option.entity.js');
    const { validateOptionList, isValidOptionValue } = await import(
      './attribute-option-validator.js'
    );
    const attr = await this.getAttributeByIdOrKey(attributeIdOrKey);
    if (!isValidOptionValue(input.value)) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `invalid_option_value: ${input.value}`);
    }
    const existing = await this.listAttributeOptions(attr.id);
    const candidate = {
      value: input.value,
      labelDefault: input.labelDefault,
      isDefault: input.isDefault ?? false,
    };
    const result = validateOptionList(
      [
        ...existing.map((o) => ({
          value: o.value,
          labelDefault: o.labelDefault,
          isDefault: o.isDefault,
        })),
        candidate,
      ],
      attr.valueType,
    );
    if (!result.ok) {
      const first = result.errors[0]!;
      throw new HttpError(
        first.code === 'attribute_type_unsupported' ? 400 : 409,
        ERROR_CODES.VALIDATION_FAILED,
        first.message,
      );
    }
    const em = this.emFactory();
    const sortOrder =
      input.sortOrder ??
      (existing.length > 0 ? Math.max(...existing.map((o) => o.sortOrder)) + 1 : 0);
    const row = em.create(AttributeOption, {
      attributeId: attr.id,
      value: input.value,
      label: input.label ?? {},
      labelDefault: input.labelDefault,
      isDefault: input.isDefault ?? false,
      sortOrder,
    });
    await em.persistAndFlush(row);
    return row;
  }

  /** Feature 012 / US4 — patch one option (value is immutable per FR-026). */
  async patchAttributeOption(
    optionId: string,
    input: {
      label?: Record<string, string>;
      labelDefault?: string;
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): Promise<import('../entities/attribute-option.entity.js').AttributeOption> {
    const { AttributeOption } = await import('../entities/attribute-option.entity.js');
    const em = this.emFactory();
    const row = await em.findOne(AttributeOption, { id: optionId });
    if (!row) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute option ${optionId} not found.`);
    }
    if (input.label !== undefined) row.label = input.label;
    if (input.labelDefault !== undefined) row.labelDefault = input.labelDefault;
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    if (input.isDefault !== undefined) {
      row.isDefault = input.isDefault;
      if (input.isDefault) {
        const { validateOptionList } = await import('./attribute-option-validator.js');
        const attr = await this.getAttributeByIdOrKey(row.attributeId);
        const all = await this.listAttributeOptions(row.attributeId);
        const reslist = all.map((o) => ({
          value: o.value,
          labelDefault: o.labelDefault,
          isDefault: o.id === row.id ? true : o.isDefault,
        }));
        const result = validateOptionList(reslist, attr.valueType);
        if (!result.ok) {
          throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, result.errors[0]!.message);
        }
      }
    }
    await em.flush();
    return row;
  }

  /** Feature 012 / US4 — remove one option. Refused while products carry it (FR-025). */
  async removeAttributeOption(optionId: string): Promise<void> {
    const { AttributeOption } = await import('../entities/attribute-option.entity.js');
    const em = this.emFactory();
    const row = await em.findOne(AttributeOption, { id: optionId });
    if (!row) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute option ${optionId} not found.`);
    }
    const attr = await this.getAttributeByIdOrKey(row.attributeId);
    const refs = (await em
      .getConnection()
      .execute<Array<{ count: string }>>(
        attr.valueType === 'multiselect'
          ? `select count(*)::text as count from products where attribute_values->? \\? ?`
          : `select count(*)::text as count from products where attribute_values->>? = ?`,
        [attr.key, row.value],
      )) as Array<{ count: string }>;
    const productCount = Number(refs[0]?.count ?? '0');
    if (productCount > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `option_in_use: ${productCount} product(s) still carry value '${row.value}'.`,
      );
    }
    await em.removeAndFlush(row);
  }

  /**
   * Feature 012 — projection of the legacy `enumValues: string[]` shape
   * from the new `attribute_options` rows for one attribute. Returns
   * `null` when the attribute is non-select-style or has no options.
   */
  async getAttributeOptionValues(attributeId: string): Promise<string[] | null> {
    const em = this.emFactory();
    const rows = (await em
      .getConnection()
      .execute<Array<{ value: string }>>(
        `select "value" from "attribute_options" where "attribute_id" = ? order by "sort_order" asc, "value" asc`,
        [attributeId],
      )) as Array<{ value: string }>;
    if (rows.length === 0) return null;
    return rows.map((r) => r.value);
  }

  /** Feature 012 — bulk variant of getAttributeOptionValues for the list endpoint. */
  async getAttributeOptionValuesByIds(
    attributeIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (attributeIds.length === 0) return out;
    const em = this.emFactory();
    // Use individual `?` placeholders so MikroORM binds each id as a
    // separate parameter (its array binder doesn't work with ANY()).
    const placeholders = attributeIds.map(() => '?').join(', ');
    const rows = (await em
      .getConnection()
      .execute<Array<{ attribute_id: string; value: string }>>(
        `select "attribute_id", "value" from "attribute_options" where "attribute_id" in (${placeholders}) order by "sort_order" asc, "value" asc`,
        attributeIds as unknown as string[],
      )) as Array<{ attribute_id: string; value: string }>;
    for (const r of rows) {
      const list = out.get(r.attribute_id) ?? [];
      list.push(r.value);
      out.set(r.attribute_id, list);
    }
    return out;
  }

  /** Feature 012 — read a single attribute by UUID or snake_case key. */
  async getAttributeByIdOrKey(idOrKey: string): Promise<ProductAttribute> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    const em = this.emFactory();
    const attr = await em.findOne(
      ProductAttribute,
      isUuid ? { id: idOrKey } : { key: idOrKey },
    );
    if (!attr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${idOrKey}" not found.`);
    }
    return attr;
  }

  /**
   * Feature 012 — delete an attribute. Refused while any Attribute Set or
   * product still references it (FR-006). The structured error names the
   * dependent rows so the admin UI can guide the operator.
   */
  async deleteAttribute(idOrKey: string): Promise<void> {
    const em = this.emFactory();
    const attr = await this.getAttributeByIdOrKey(idOrKey);
    const setRefs = (await em
      .getConnection()
      .execute<Array<{ attribute_set_id: string }>>(
        `select attribute_set_id from attribute_set_attributes where product_attribute_id = ?`,
        [attr.id],
      )) as Array<{ attribute_set_id: string }>;
    if (setRefs.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Attribute is still referenced by ${setRefs.length} attribute set(s); remove from sets first.`,
      );
    }
    const productRefs = (await em
      .getConnection()
      .execute<Array<{ count: string }>>(
        `select count(*)::text as count from products where attribute_values \\? ?`,
        [attr.key],
      )) as Array<{ count: string }>;
    const productCount = Number(productRefs[0]?.count ?? '0');
    if (productCount > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Attribute is still referenced by ${productCount} product(s); clear values first.`,
      );
    }
    await em.removeAndFlush(attr);
  }

  // ------------------------------------------------------------------

  // ===== Feature 002 (T054 backend prereq) — Variants CRUD =================

  async createVariant(
    parentProductId: string,
    req: CreateVariantRequest,
  ): Promise<ProductVariant> {
    const em = this.emFactory();
    const parent = await em.findOne(Product, { id: parentProductId });
    if (!parent) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product ${parentProductId} not found.`,
      );
    }
    if (parent.type !== 'configurable') {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Variants can only be added to configurable Products; this Product is ${parent.type}.`,
      );
    }
    // SKU uniqueness MUST hold across both products and variants.
    const existingProduct = await em.findOne(Product, { sku: req.sku });
    if (existingProduct) {
      throw new HttpError(
        409,
        ERROR_CODES.SKU_ALREADY_EXISTS,
        `SKU "${req.sku}" already taken by an existing Product.`,
      );
    }
    const variant = em.create(ProductVariant, {
      parentProductId,
      sku: req.sku,
      variantAttributeValues: req.variantAttributeValues,
      ...(req.priceOverride !== undefined
        ? { priceOverride: String(req.priceOverride) }
        : {}),
      ...(req.stockLevel !== undefined ? { stockLevel: req.stockLevel } : {}),
    });
    try {
      await em.persistAndFlush(variant);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.SKU_ALREADY_EXISTS,
          `SKU "${req.sku}" already taken by an existing Variant.`,
        );
      }
      throw err;
    }
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: parentProductId,
      changedFields: ['variants'],
    });
    return variant;
  }

  async updateVariant(
    parentProductId: string,
    variantId: string,
    req: UpdateVariantRequest,
  ): Promise<ProductVariant> {
    const em = this.emFactory();
    const variant = await em.findOne(ProductVariant, {
      id: variantId,
      parentProductId,
    });
    if (!variant) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Variant ${variantId} not found under Product ${parentProductId}.`,
      );
    }
    if (req.variantAttributeValues !== undefined) {
      variant.variantAttributeValues = req.variantAttributeValues;
    }
    if (req.priceOverride !== undefined) {
      variant.priceOverride = String(req.priceOverride);
    }
    if (req.stockLevel !== undefined) {
      variant.stockLevel = req.stockLevel;
    }
    await em.flush();
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: parentProductId,
      changedFields: ['variants'],
    });
    return variant;
  }

  async deleteVariant(parentProductId: string, variantId: string): Promise<void> {
    const em = this.emFactory();
    const variant = await em.findOne(ProductVariant, {
      id: variantId,
      parentProductId,
    });
    if (!variant) {
      // DELETE is idempotent — but we still 404 here so admins notice
      // typo'd ids. Foundation pattern (admin DELETE on missing rows
      // returns 404 too, e.g. category soft-delete).
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Variant ${variantId} not found under Product ${parentProductId}.`,
      );
    }
    await em.removeAndFlush(variant);
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: parentProductId,
      changedFields: ['variants'],
    });
  }

  /**
   * Feature 002 (T023) — reject unknown keys in `attributeValues` against
   * the Product's AttributeSet. Empty input is a no-op (a Product with
   * zero attribute values is always valid).
   *
   * Throws 400 ATTRIBUTE_VALUE_REJECTED with `details: [{ path, issue }]`
   * listing the rejected keys.
   */
  private async assertAttributeValueKeysAllowed(
    em: EntityManager,
    attributeSetId: string,
    attributeValues: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!attributeValues) return;
    const keys = Object.keys(attributeValues);
    if (keys.length === 0) return;

    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select pa.key
       from attribute_set_attributes asa
       join product_attributes pa on pa.id = asa.product_attribute_id
       where asa.attribute_set_id = ?`,
      [attributeSetId],
    )) as Array<{ key: string }>;
    const allowed = new Set(rows.map((r) => r.key));

    const rejected = keys.filter((k) => !allowed.has(k));
    if (rejected.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.ATTRIBUTE_VALUE_REJECTED,
        `Attribute key(s) not in this Product's Attribute Set: ${rejected.join(', ')}.`,
        rejected.map((k) => ({
          path: `attributeValues.${k}`,
          issue: 'attribute is not assigned to this Product\'s AttributeSet',
        })),
      );
    }
  }

  /**
   * Feature 012 / FR-013 — refuse a product save that leaves any
   * required attribute (from the assigned set) without a value. Called
   * after `assertAttributeValueKeysAllowed`; uses the merged
   * (existing + patched) value map so a previously-set value satisfies
   * the requirement even when the current patch omits it.
   */
  async assertRequiredAttributesPresent(
    em: EntityManager,
    attributeSetId: string,
    mergedAttributeValues: Record<string, unknown>,
  ): Promise<void> {
    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select pa.key
       from attribute_set_attributes asa
       join product_attributes pa on pa.id = asa.product_attribute_id
       where asa.attribute_set_id = ?
         and pa.is_required = true`,
      [attributeSetId],
    )) as Array<{ key: string }>;
    const missing = rows
      .map((r) => r.key)
      .filter((k) => {
        const v = mergedAttributeValues[k];
        return v === undefined || v === null || v === '';
      });
    if (missing.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `missing_required_attribute_values: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Feature 012 / US2 — preview a Set swap on a Product. Returns the
   * shape documented in `contracts/attribute-sets.contract.md` —
   * attributesAdded, attributesRemoved, valuesPreserved (R-7),
   * requiredButMissing.
   */
  async previewAttributeSetSwap(
    productId: string,
    targetSetId: string | null,
  ): Promise<{
    attributesAdded: Array<{ key: string; labelDefault: string; isRequired: boolean }>;
    attributesRemoved: Array<{ key: string; labelDefault: string }>;
    valuesPreserved: Array<{ key: string; valueSample: unknown }>;
    requiredButMissing: Array<{ key: string; labelDefault: string }>;
  }> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const conn = em.getConnection();
    const fetchKeys = async (
      setId: string | null,
    ): Promise<Map<string, { labelDefault: string; isRequired: boolean }>> => {
      const out = new Map<string, { labelDefault: string; isRequired: boolean }>();
      if (!setId) return out;
      const rows = (await conn.execute(
        `select pa.key, pa.label_default as label_default, pa.is_required as is_required
         from attribute_set_attributes asa
         join product_attributes pa on pa.id = asa.product_attribute_id
         where asa.attribute_set_id = ?`,
        [setId],
      )) as Array<{ key: string; label_default: string; is_required: boolean }>;
      for (const r of rows) {
        out.set(r.key, { labelDefault: r.label_default, isRequired: r.is_required });
      }
      return out;
    };
    const before = await fetchKeys(product.attributeSetId ?? null);
    const after = await fetchKeys(targetSetId);
    const attributesAdded: Array<{ key: string; labelDefault: string; isRequired: boolean }> = [];
    const attributesRemoved: Array<{ key: string; labelDefault: string }> = [];
    for (const [key, meta] of after) {
      if (!before.has(key)) attributesAdded.push({ key, labelDefault: meta.labelDefault, isRequired: meta.isRequired });
    }
    for (const [key, meta] of before) {
      if (!after.has(key)) attributesRemoved.push({ key, labelDefault: meta.labelDefault });
    }
    const currentValues = product.attributeValues ?? {};
    const valuesPreserved: Array<{ key: string; valueSample: unknown }> = [];
    for (const [key, value] of Object.entries(currentValues)) {
      if (!after.has(key) && value !== undefined && value !== null && value !== '') {
        valuesPreserved.push({ key, valueSample: value });
      }
    }
    const requiredButMissing: Array<{ key: string; labelDefault: string }> = [];
    for (const [key, meta] of after) {
      if (meta.isRequired) {
        const v = currentValues[key];
        if (v === undefined || v === null || v === '') {
          requiredButMissing.push({ key, labelDefault: meta.labelDefault });
        }
      }
    }
    return { attributesAdded, attributesRemoved, valuesPreserved, requiredButMissing };
  }

  private slugify(value: string): string {
    // \p{Diacritic} strips combining marks left over from NFKD normalization
    // so accented Latin characters collapse onto their base letter; non-Latin
    // characters drop entirely via the [^a-z0-9]+ pass below.
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160);
  }

  private anyValue(blob: Record<string, string>): string {
    const key = Object.keys(blob)[0];
    return key ? (blob[key] ?? '') : '';
  }
}

/**
 * Maps an API-form attribute request onto the persisted `valueType` +
 * `displayAsSlider` pair (research R-7). Either `type` (preferred) or
 * `valueType` (legacy) MUST be set — Zod refines guarantee it for create;
 * update callers pass `type` explicitly so it's always present here.
 */
export function resolveAttributeApiType(req: {
  type?: ApiAttributeType | undefined;
  valueType?: AttributeValueType | undefined;
  numericKind?: NumericKind | undefined;
  displayAsSlider?: boolean | undefined;
}): { valueType: AttributeValueType; displayAsSlider: boolean } {
  if (req.type === undefined) {
    if (req.valueType === undefined) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'either type or valueType is required',
      );
    }
    return {
      valueType: req.valueType,
      displayAsSlider: req.displayAsSlider ?? false,
    };
  }
  switch (req.type) {
    case 'input':
      return { valueType: 'string', displayAsSlider: false };
    case 'number':
      return { valueType: 'number', displayAsSlider: req.displayAsSlider ?? false };
    case 'select':
      return { valueType: 'enum', displayAsSlider: false };
    case 'multiselect':
      return { valueType: 'multiselect', displayAsSlider: false };
    case 'price':
      return { valueType: 'price', displayAsSlider: req.displayAsSlider ?? false };
    case 'slider': {
      // Zod refine catches the missing-numericKind path; this is a
      // belt-and-braces guard for direct service callers (seeders, etc).
      if (req.numericKind === undefined) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'numericKind is required when type=slider',
        );
      }
      return {
        valueType: req.numericKind === 'price' ? 'price' : 'number',
        displayAsSlider: true,
      };
    }
  }
}

/**
 * Inverse of `resolveAttributeApiType` — derives the API-form `type` +
 * `numericKind` from the persisted (`valueType`, `displayAsSlider`) pair
 * so list/detail responses surface the form admins authored against.
 */
export function dbToApiAttributeType(
  valueType: AttributeValueType,
  displayAsSlider: boolean,
): { type: ApiAttributeType; numericKind: NumericKind | null } {
  if (displayAsSlider && (valueType === 'number' || valueType === 'price')) {
    return { type: 'slider', numericKind: valueType };
  }
  switch (valueType) {
    case 'string':
      return { type: 'input', numericKind: null };
    case 'number':
      return { type: 'number', numericKind: null };
    case 'enum':
      return { type: 'select', numericKind: null };
    case 'select':
      // Feature 012 — `'select'` shares storage with `'enum'`; differs only in
      // rendering intent (compact pill vs full dropdown). Maps to the same
      // API affordance for now.
      return { type: 'select', numericKind: null };
    case 'multiselect':
      return { type: 'multiselect', numericKind: null };
    case 'price':
      return { type: 'price', numericKind: null };
    case 'boolean':
    case 'date':
      // These DB-only types have no API alias; surface the legacy form.
      return { type: 'input', numericKind: null };
  }
}
