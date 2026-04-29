import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type CreateAttributeRequest,
  type CreateProductRequest,
  type UpdateAttributeRequest,
  type UpdateProductRequest,
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
import {
  assertVirtualDownloadFields,
  ProductTypeValidationError,
} from './product-type-validations.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

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
      name: { ...product.name },
      description: { ...product.description },
      stockMode: product.stockMode,
      visibility: product.visibility,
      attributeValues: { ...product.attributeValues },
      allowedOrganizationIds: [...product.allowedOrganizationIds],
    };
    const changedFields: string[] = [];
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
    // Feature 002 (T035) — displayAsSlider is honored only on numeric
    // value types. Reject with INVALID_DISPLAY_AS_SLIDER otherwise so
    // bad UI inputs don't silently degrade.
    if (
      req.displayAsSlider &&
      req.valueType !== 'number' &&
      req.valueType !== 'price'
    ) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `displayAsSlider is only valid for valueType="number" or "price"; got "${req.valueType}".`,
      );
    }
    const attr = em.create(ProductAttribute, {
      key: req.key,
      label: req.label,
      valueType: req.valueType,
      enumValues: req.enumValues ?? null,
      isSearchable: req.isSearchable,
      isFilterable: req.isFilterable,
      isVariantAxis: req.isVariantAxis,
      displayAsSlider: req.displayAsSlider ?? false,
    });
    try {
      await em.persistAndFlush(attr);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `Attribute key "${req.key}" already exists.`);
      }
      throw err;
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

  async updateAttribute(key: string, req: UpdateAttributeRequest): Promise<ProductAttribute> {
    const em = this.emFactory();
    const attr = await em.findOne(ProductAttribute, { key });
    if (!attr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${key}" not found.`);
    }
    if (req.label !== undefined) attr.label = req.label;
    if (req.enumValues !== undefined) attr.enumValues = req.enumValues;
    if (req.isSearchable !== undefined) attr.isSearchable = req.isSearchable;
    if (req.isFilterable !== undefined) attr.isFilterable = req.isFilterable;
    if (req.isVariantAxis !== undefined) attr.isVariantAxis = req.isVariantAxis;
    if (req.displayAsSlider !== undefined) {
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

  // ------------------------------------------------------------------

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
