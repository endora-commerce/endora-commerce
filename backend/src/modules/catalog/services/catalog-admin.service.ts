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

  async createProduct(req: CreateProductRequest): Promise<Product> {
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
      product.sku = trimmed;
      changedFields.push('sku');
    }
    if (req.name) { product.name = req.name; changedFields.push('name'); }
    if (req.description) { product.description = req.description; changedFields.push('description'); }
    if (req.stockMode !== undefined) { product.stockMode = req.stockMode; changedFields.push('stockMode'); }
    if (req.visibility) { product.visibility = req.visibility; changedFields.push('visibility'); }
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
    if (req.allowedOrganizationIds) {
      product.allowedOrganizationIds = req.allowedOrganizationIds;
      changedFields.push('allowedOrganizationIds');
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

  async archiveProduct(id: string): Promise<void> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    product.status = 'archived';
    product.archivedAt = new Date();
    await em.flush();
    this.events.emit('product.archived.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: product.id,
    });
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

  async listProducts(options: { includeArchived?: boolean } = {}): Promise<Product[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (!options.includeArchived) where['status'] = { $ne: 'archived' };
    return em.find(Product, where, { orderBy: { createdAt: 'desc' }, limit: 200 });
  }

  async getProductById(id: string): Promise<Product> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    return product;
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
      | 'isRequired',
  ): Promise<ProductAttribute[]> {
    const em = this.emFactory();
    return em.find(
      ProductAttribute,
      { [flag]: true } as Partial<ProductAttribute>,
      { orderBy: { key: 'asc' } },
    );
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
