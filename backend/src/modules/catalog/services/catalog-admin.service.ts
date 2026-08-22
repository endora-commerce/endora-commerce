import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  // Aliased: the private method below keeps the name, so the shared function
  // needs one the class body cannot shadow.
  slugify as slugifyText,
  type CatalogAdminAuditContext,
  type CreateAttributeRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type UpdateAttributeRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
} from '@endora-commerce/contracts';
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

/**
 * How a duplicate inherits the source's per-warehouse low-stock thresholds
 * (issue #185).
 *
 * The rows live in `inventory`'s `product_warehouse_low_stock_thresholds`, and
 * this service used to write them with an `insert … select` of its own — no
 * import specifier for the boundary check to see, no gate, and no audit row on
 * the owner's side. `inventory` publishes the copy now.
 *
 * `'not-present'` rather than a throw or a `catch`: `inventory` is
 * deactivatable and this module declares the edge `degrades-without`, so
 * absence is **decided** in front of the gate by the wiring in `backend.ts` and
 * arrives here in the return type. A duplicate made while the module is off
 * carries no per-warehouse thresholds and falls back to the product-level and
 * warehouse-level chain — which is what a duplicate looks like on a deployment
 * that never installed `inventory`.
 */
export type CatalogWarehouseThresholdCopy = (input: {
  sourceProductId: string;
  targetProductId: string;
}) => Promise<{ copied: number } | 'not-present'>;
import { HttpError } from '../../../http/error-envelope.js';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import {
  assertVirtualDownloadFields,
  ProductTypeValidationError,
} from './product-type-validations.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import type { CustomFieldDefinitionWithOptions } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '../../../commands/index.js';
// D-77 — the apply seam is named once in this module, by `attribute-commands.ts`
// (see the re-export there for why it is a re-export and not a local
// declaration). This file extends it into the slice the catalog write path uses.
import type { CustomFieldDefinitionApplyApi } from '../commands/attribute-commands.js';

import type {
  CatalogAttributeReadService,
  CatalogAttributeView,
} from './catalog-attribute-read.service.js';
import {
  createAttributeCommand,
  createAttributeOptionCommand,
  deleteAttributeCommand,
  deleteAttributeOptionCommand,
  updateAttributeCommand,
  updateAttributeOptionCommand,
  type AttributeCommandDeps,
  type AttributeOptionCommandTarget,
  type AttributeOptionResult,
} from '../commands/attribute-commands.js';

// Feature 061 — the API-form mapping helpers moved next to the R7 map; the
// re-exports keep the long-standing import site (routes, tests) stable.
export { dbToApiAttributeType, resolveAttributeApiType } from './attribute-type-mapping.js';

/**
 * The slice of the custom_fields definition service the catalog write path
 * needs: the transactional apply seam + the committed-state read used for
 * audit capture and option guards. `CustomFieldDefinitionService` satisfies
 * this structurally (Principle I — documented exported service surface only).
 */
export interface CatalogCustomFieldsPort extends CustomFieldDefinitionApplyApi {
  getById(id: string): Promise<CustomFieldDefinitionWithOptions | null>;
}

/**
 * Optional metadata used to attach audit entries to admin mutations.
 *
 * Published as `CatalogAdminAuditContext` in feature 075's Phase P — the
 * write port's two audited methods take it — and aliased back here so the two
 * cannot drift.
 */
export type AdminAuditContext = CatalogAdminAuditContext;

/**
 * Virtual attribute-value keys that are NOT bound to any AttributeSet but are
 * legitimately stored under `product.attributeValues`. `defaultPrice` / `price`
 * are the per-product base price the Details tab edits and the PriceList engine
 * reads (see `default-price-list-migration.ts`). They must never be rejected by
 * `assertAttributeValueKeysAllowed`, otherwise every save that carries a price
 * (i.e. nearly all of them) fails with ATTRIBUTE_VALUE_REJECTED.
 */
const VIRTUAL_ATTRIBUTE_VALUE_KEYS: ReadonlySet<string> = new Set([
  'defaultPrice',
  'price',
]);

/**
 * Feature 068 — the width of `products.sku` / `product_variants.sku` and the
 * cap the create and update contracts enforce. Nothing may write a longer
 * identifier, derived or otherwise.
 */
const SKU_MAX_LENGTH = 255;

/**
 * Catalog write-path service (admin write surface).
 * Every mutation emits a typed event on the shared bus so the search indexer
 * (T067) and webhook bridge (Phase 2 T037) can react.
 */

export class CatalogAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: CatalogEventBus,
    private readonly auditLog?: AuditPort,
    /**
     * Feature 005 / T027 — when injected, every newly-created Product
     * that does not declare explicit channel membership lands in the
     * system-default Sales Channel automatically (FR-011). Optional so
     * existing tests that construct this service without sales-channels
     * keep compiling; production composition.ts always provides it.
     */
    private readonly salesChannelMembership?: SalesChannelMembershipPort,
    /**
     * Feature 054 — when injected, `updateProductAudited` records the admin
     * single-update through the Command Bus (co-transactional audit + event).
     */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 061 — composed attribute read model. Required for every
     * attribute/option method; optional in the signature so legacy product-only
     * fixtures keep constructing the service without attribute wiring.
     */
    private readonly attributeRead?: CatalogAttributeReadService,
    /**
     * Feature 061 — custom_fields apply seam + committed-state definition read.
     * Required for attribute/option mutations.
     */
    private readonly customFields?: CatalogCustomFieldsPort,
    /**
     * Issue #185 — `inventory`'s per-warehouse threshold copy, presence-decided
     * by the wiring. Optional for the same reason every collaborator above it
     * is: fixtures that duplicate a product without an inventory composition
     * keep constructing this service, and a duplicate with no thresholds copied
     * is the module's declared degrade rather than a failure.
     */
    private readonly copyWarehouseThresholds?: CatalogWarehouseThresholdCopy,
  ) {}

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'CatalogAdminService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  #requireCustomFields(): CatalogCustomFieldsPort {
    if (!this.customFields) {
      throw new Error(
        'CatalogAdminService: the custom_fields definition port is not wired — attribute writes are unavailable.',
      );
    }
    return this.customFields;
  }

  #attributeCommandDeps(): AttributeCommandDeps {
    const customFields = this.#requireCustomFields();
    return {
      apply: customFields,
      readDefinition: (id) => customFields.getById(id),
    };
  }

  /**
   * Feature 061 — run a catalog Command through the bus (audited) or, in
   * bus-less fixtures, directly on a transactional em (no audit — same
   * fallback contract as {@link #auditedWrite}). The domain event declared on
   * the command is emitted either way (on commit only).
   */
  async #runCommand<T>(command: Command<T>): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run(command);
    }
    const em = this.emFactory();
    const result = await em.transactional(async (tem) => {
      const outcome = await command.run({
        em: tem,
        actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
      });
      return outcome.result;
    });
    const evt = command.event?.(result);
    if (evt) {
      this.events.emit(
        evt.eventName as keyof CatalogEvents & string,
        evt.payload as CatalogEvents[keyof CatalogEvents & string],
      );
    }
    return result;
  }

  /**
   * Enqueues a full Meilisearch reindex (a `search_reindex` bulk operation)
   * when an attribute's `searchable` flag flips. Set by the catalog plugin
   * once the BulkOperationService exists (it is constructed after this
   * service). When unset, a flag change still emits `attribute.updated.v1`
   * (the lightweight settings refresh) but no reindex is queued.
   */
  private enqueueSearchReindex?: (ctx: {
    actorAdminUserId: string | null;
    attributeKey: string;
  }) => Promise<void>;

  setSearchReindexEnqueuer(
    fn: (ctx: { actorAdminUserId: string | null; attributeKey: string }) => Promise<void>,
  ): void {
    this.enqueueSearchReindex = fn;
  }

  /**
   * Feature 068 — product creation runs as the `product.create` Command, so the
   * audit entry, the domain event and the row commit or roll back as one unit
   * (Principle XIII). This closed the gap that made every worker-created product
   * unaudited: the audit used to be a hand-written post-commit call that only
   * fired when the caller supplied `auditCtx`, which no background caller has.
   *
   * `_auditCtx` is retained so the long-standing admin call site keeps compiling;
   * the actor is now derived server-side from the ambient TenantContext.
   */
  async createProduct(
    req: CreateProductRequest,
    _auditCtx?: AdminAuditContext,
  ): Promise<Product> {
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

    // The id is allocated up front so the Command can name its audit target
    // before the row exists (same shape as `duplicateProduct`).
    const productId = randomUUID();
    let product: Product;
    try {
      product = await this.#runCommand(this.#createProductCommand(productId, req));
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(409, ERROR_CODES.SKU_ALREADY_EXISTS, `SKU "${req.sku}" already exists.`);
      }
      throw err;
    }

    // Feature 005 / FR-011 — bind to Default unless this product was
    // already given memberships through some other path. Stays OUTSIDE the
    // Command: the membership service writes on its own em, which cannot see
    // the product row until the Command's transaction has committed.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('product', product.id);
    }

    return product;
  }

  #createProductCommand(productId: string, req: CreateProductRequest): Command<Product> {
    return {
      action: 'product.create',
      objectType: 'product',
      objectId: productId,
      run: async ({ em }) => {
        // Feature 068 — `products.slug` is `@Unique()`, so the derived slug has
        // to be allocated against the live table. Without this, two products
        // sharing a name collided on the slug index and the catch above
        // mislabelled the failure `SKU_ALREADY_EXISTS`.
        const slug = await this.allocateUniqueSlug(em, this.anyValue(req.name) || req.sku);
        const product = em.create(Product, {
          id: productId,
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
        em.persist(product);
        await em.flush();
        return {
          result: product,
          after: {
            sku: product.sku,
            name: { ...product.name },
            status: product.status,
            visibility: product.visibility,
            stockMode: product.stockMode,
          },
        };
      },
      event: (product) => ({
        eventName: 'product.created.v1',
        payload: {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          productId: product.id,
          sku: product.sku,
        },
      }),
    };
  }

  async updateProduct(
    id: string,
    req: UpdateProductRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<Product> {
    const em = this.emFactory();
    const r = await this.#applyProductUpdate(em, id, req);
    await em.flush();
    if (this.auditLog && auditCtx) {
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'product.update',
        objectType: 'product',
        objectId: r.product.id,
        stateBefore: r.stateBefore,
        stateAfter: { ...r.stateAfter, changedFields: r.changedFields },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: r.product.id,
      changedFields: r.changedFields,
    });
    return r.product;
  }

  /**
   * Feature 054 — admin single-update path, audited co-transactionally via the
   * Command Bus (one audit row + the event on commit, none on rollback). Falls
   * back to the legacy `updateProduct` when no bus is injected (bus-less tests).
   */
  async updateProductAudited(id: string, req: UpdateProductRequest): Promise<Product> {
    if (!this.commandBus) return this.updateProduct(id, req);
    return this.commandBus.run(this.#updateProductCommand(id, req));
  }

  #updateProductCommand(id: string, req: UpdateProductRequest): Command<Product> {
    let changedFields: string[] = [];
    return {
      action: 'product.update',
      objectType: 'product',
      objectId: id,
      run: async ({ em }) => {
        const r = await this.#applyProductUpdate(em, id, req);
        changedFields = r.changedFields;
        return {
          result: r.product,
          before: r.stateBefore,
          after: { ...r.stateAfter, changedFields },
        };
      },
      event: (product) => ({
        eventName: 'product.updated.v1',
        payload: {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          productId: product.id,
          changedFields,
        },
      }),
    };
  }

  /**
   * Pure product-update write on the given em — no flush, no audit, no event.
   * Shared by the legacy `updateProduct` and the audited Command path.
   */
  async #applyProductUpdate(
    em: EntityManager,
    id: string,
    req: UpdateProductRequest,
  ): Promise<{
    product: Product;
    stateBefore: Record<string, unknown>;
    stateAfter: Record<string, unknown>;
    changedFields: string[];
  }> {
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
      // Feature 068 — 255 is the width of `products.sku` and the cap the
      // create contract enforces. This guard used to read 160 while the
      // column held 64, so a 100-character rename passed validation and then
      // failed at the database; all three now agree.
      if (trimmed.length === 0 || trimmed.length > 255) {
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
        new Set(Object.keys(product.attributeValues ?? {})),
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
    const stateAfter: Record<string, unknown> = {
      name: { ...product.name },
      description: { ...product.description },
      stockMode: product.stockMode,
      visibility: product.visibility,
      status: product.status,
      archivedAt: product.archivedAt ?? null,
      attributeValues: { ...product.attributeValues },
      allowedOrganizationIds: [...product.allowedOrganizationIds],
    };
    return { product, stateBefore, stateAfter, changedFields };
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
  /**
   * Feature 054 — run a catalog write through the Command Bus (co-transactional
   * audit) or a plain forked em (bus-less tests). `write` performs the mutation
   * on the given em and returns the caller value + before/after snapshot.
   */
  async #auditedWrite<T>(
    action: string,
    objectType: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType, objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

  async duplicateProduct(id: string): Promise<Product> {
    const em = this.emFactory();
    const source = await em.findOne(Product, { id });
    if (!source) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const newSku = await this.allocateCopySku(em, source.sku);
    const newSlug = await this.allocateCopySlug(em, source.slug);

    // The dup product row + its audit are co-transactional; the bridge copies
    // run AFTER on this em (matches the pre-054 two-step) — the dup FK target
    // exists once committed, and a partially-copied dup is no worse than today.
    const dupId = randomUUID();
    const dup = await this.#auditedWrite('product.duplicate', 'product', dupId, async (cem) => {
      const created = cem.create(Product, {
        id: dupId,
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
      await cem.flush();
      return {
        result: created,
        before: null,
        after: { sku: newSku, slug: newSlug, sourceProductId: id },
      };
    });


    // product_categories (bridge)
    await em.execute(
      `insert into "product_categories" ("product_id", "category_id")
         select ?, "category_id" from "product_categories" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // The channel assortment, through the kernel's membership service (issue
    // #185). This was an `insert … select` against the bridge table, which is
    // Principle XII's accessor clause and Principle XIII in one statement: the
    // bridge was written directly and not one of the memberships the duplicate
    // gained was audited. `copyMemberships` adds them one audited call at a
    // time.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.copyMemberships('product', source.id, dup.id);
    }

    // gallery_items + gallery_item_labels — we need a fresh UUID per item
    // and to rewrite the bridge rows to the new ids.
    const galleryRows = (await em.execute(
      `select "id", "asset_id", "position" from "gallery_items"
         where "product_id" = ? order by "position" asc`,
      [source.id],
    )) as Array<{ id: string; asset_id: string; position: number }>;
    if (galleryRows.length > 0) {
      const idMap = new Map<string, string>();
      for (const row of galleryRows) {
        const newId = randomUUID();
        idMap.set(row.id, newId);
        await em.execute(
          `insert into "gallery_items"
             ("id", "product_id", "asset_id", "position", "created_at", "updated_at")
             values (?, ?, ?, ?, now(), now())`,
          [newId, dup.id, row.asset_id, row.position],
        );
      }
      const labelRows = (await em.execute(
        `select "gallery_item_id", "label" from "gallery_item_labels"
           where "product_id" = ?`,
        [source.id],
      )) as Array<{ gallery_item_id: string; label: string }>;
      for (const lbl of labelRows) {
        const mapped = idMap.get(lbl.gallery_item_id);
        if (!mapped) continue;
        await em.execute(
          `insert into "gallery_item_labels"
             ("gallery_item_id", "product_id", "label") values (?, ?, ?)`,
          [mapped, dup.id, lbl.label],
        );
      }
    }

    // product_attachments
    await em.execute(
      `insert into "product_attachments"
         ("id", "product_id", "asset_id", "attachment_type_id", "name", "description", "position", "created_at", "updated_at")
         select gen_random_uuid(), ?, "asset_id", "attachment_type_id", "name", "description", "position", now(), now()
           from "product_attachments" where "product_id" = ?`,
      [dup.id, source.id],
    );

    // product_links (only outgoing links are copied — incoming links from
    // other products toward the source product stay attached to the source)
    await em.execute(
      `insert into "product_links"
         ("id", "source_product_id", "target_product_id", "kind", "position", "created_at", "updated_at")
         select gen_random_uuid(), ?, "target_product_id", "kind", "position", now(), now()
           from "product_links" where "source_product_id" = ?`,
      [dup.id, source.id],
    );

    // grouped_items (children of a grouped product)
    if (source.type === 'grouped') {
      await em.execute(
        `insert into "grouped_items"
           ("id", "parent_product_id", "child_product_id", "quantity", "position", "created_at", "updated_at")
           select gen_random_uuid(), ?, "child_product_id", "quantity", "position", now(), now()
             from "grouped_items" where "parent_product_id" = ?`,
        [dup.id, source.id],
      );
    }

    // bundle_slots + bundle_slot_options
    if (source.type === 'bundle') {
      const slotRows = (await em.execute(
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
        await em.execute(
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
        await em.execute(
          `insert into "bundle_slot_options"
             ("id", "slot_id", "option_product_id", "default_quantity", "position", "created_at", "updated_at")
             select gen_random_uuid(), ?, "option_product_id", "default_quantity", "position", now(), now()
               from "bundle_slot_options" where "slot_id" = ?`,
          [newSlotId, slot.id],
        );
      }
    }

    // Per-(product, warehouse) low-stock thresholds, so the duplicate inherits
    // the source's alerting profile. `inventory`'s rows and `inventory`'s
    // Command since issue #185 — this used to be an `insert … select` into that
    // module's table from here, which kept writing while an operator had the
    // module switched off. No `catch` around it: the wiring decides presence in
    // front of the gate and the degrade arrives as `'not-present'`.
    if (this.copyWarehouseThresholds) {
      await this.copyWarehouseThresholds({
        sourceProductId: source.id,
        targetProductId: dup.id,
      });
    }

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
   *
   * Feature 068 — the result must fit `SKU_MAX_LENGTH`. It is the *base* that
   * gets shortened to make room, never the suffix: cutting the suffix would
   * collapse every attempt onto the same string, so a long-SKU product could
   * never be duplicated at all.
   */
  private async allocateCopySku(em: EntityManager, baseSku: string): Promise<string> {
    for (let i = 0; i < 1000; i += 1) {
      const suffix = i === 0 ? '-copy' : `-copy-${i + 1}`;
      const base = baseSku.slice(0, SKU_MAX_LENGTH - suffix.length);
      const candidate = `${base}${suffix}`;
      const productHit = await em.findOne(Product, { sku: candidate });
      if (productHit) continue;
      const variantHit = await em.findOne(ProductVariant, { sku: candidate });
      if (variantHit) continue;
      return candidate;
    }
    throw new HttpError(
      409,
      ERROR_CODES.SKU_ALREADY_EXISTS,
      `Could not allocate a unique SKU derived from "${baseSku}".`,
    );
  }

  private async allocateCopySlug(em: EntityManager, baseSlug: string): Promise<string> {
    return this.allocateUniqueSlug(em, `${baseSlug}-copy`);
  }

  /**
   * Find a free slug derived from `source`: the slugified value itself, then
   * `-2`, `-3`, … until `products.slug` (which is `@Unique()`) is clear.
   * Bounded by 1000 attempts so a pathological collision can't hang.
   *
   * Feature 068 — used by the create path as well as the duplication path; a
   * name collision on create used to reach the database and be reported as a
   * SKU conflict.
   */
  private async allocateUniqueSlug(em: EntityManager, source: string): Promise<string> {
    const root = this.slugify(source);
    for (let i = 0; i < 1000; i += 1) {
      const candidate = i === 0 ? root : this.slugify(`${root}-${i + 1}`);
      const hit = await em.findOne(Product, { slug: candidate });
      if (!hit) return candidate;
    }
    throw new HttpError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      `Could not allocate a unique slug derived from "${source}".`,
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
    // `em.execute`, not `em.getKnex()`: the caller is `product.delete`'s Command
    // body, so this guard runs inside `CommandBus.run`'s transaction, and a knex
    // instance is connection-level — it read the state outside the transaction
    // whose write it is guarding (issue #200). `check:transaction-context`
    // cannot see this one: it is a method call away from the `run` that carries
    // the transaction, and following that hop would mean guessing at callers.
    const orderRows = (await em.execute(
      `select count(*)::int as count from "order_items" where "product_id" = ?`,
      [productId],
    )) as Array<{ count: string | number }>;
    if (Number(orderRows[0]?.count ?? 0) > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_DELETE_BLOCKED,
        'Product cannot be deleted because it is referenced by order lines.',
      );
    }
    const cartRows = (await em.execute(
      `select count(*)::int as count from "cart_items" where "product_id" = ?`,
      [productId],
    )) as Array<{ count: string | number }>;
    if (Number(cartRows[0]?.count ?? 0) > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_DELETE_BLOCKED,
        'Product cannot be deleted because it is referenced by cart lines.',
      );
    }
  }

  /**
   * Feature 068 — soft-delete runs as the `product.delete` Command: the write,
   * the audit entry and `product.deleted.v1` share one transaction. `_auditCtx`
   * is retained for the existing admin call site; the actor is server-derived.
   */
  async deleteProduct(id: string, _auditCtx?: AdminAuditContext): Promise<void> {
    await this.#runCommand(this.#deleteProductCommand(id));
  }

  #deleteProductCommand(id: string): Command<{ id: string }> {
    return {
      action: 'product.delete',
      objectType: 'product',
      objectId: id,
      run: async ({ em }) => {
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
        return {
          result: { id: product.id },
          before: stateBefore,
          after: {
            ...stateBefore,
            deletedAt: product.deletedAt?.toISOString() ?? null,
          },
        };
      },
      event: (result) => ({
        eventName: 'product.deleted.v1',
        payload: {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          productId: result.id,
        },
      }),
    };
  }

  // ------------------------------------------------------------------
  // Attributes
  // ------------------------------------------------------------------

  async createAttribute(req: CreateAttributeRequest): Promise<CatalogAttributeView> {
    const read = this.#requireAttributeRead();
    // Definition sort order: append after the current tail (matches the CF
    // admin surface's manual ordering semantics).
    const existing = await read.listAll();
    const nextSortOrder = existing.length;
    const extensionId = randomUUID();
    await this.#runCommand(
      createAttributeCommand(this.#attributeCommandDeps(), req, {
        extensionId,
        sortOrder: nextSortOrder,
      }),
    );
    await this.#requireCustomFields().publishInvalidate('product');
    const view = await read.getByIdOrKey(extensionId);
    if (!view) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${req.key}" not found.`);
    }
    return view;
  }

  async updateAttributeByIdOrKey(
    idOrKey: string,
    req: UpdateAttributeRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<CatalogAttributeView> {
    const attr = await this.getAttributeByIdOrKey(idOrKey);
    return this.applyAttributeUpdate(attr, req, auditCtx);
  }

  async updateAttribute(
    key: string,
    req: UpdateAttributeRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<CatalogAttributeView> {
    const attr = await this.getAttributeByIdOrKey(key);
    return this.applyAttributeUpdate(attr, req, auditCtx);
  }

  private async applyAttributeUpdate(
    attr: CatalogAttributeView,
    req: UpdateAttributeRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<CatalogAttributeView> {
    // Capture the searchable flag before applying so we can tell a real
    // flip apart from a save that left it untouched (only a real change
    // warrants a full reindex).
    const previousIsSearchable = attr.isSearchable;
    await this.#runCommand(
      updateAttributeCommand(this.#attributeCommandDeps(), attr.id, req),
    );
    await this.#requireCustomFields().publishInvalidate('product');
    const updated = await this.#requireAttributeRead().getByIdOrKey(attr.id);
    if (!updated) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${attr.id}" not found.`);
    }

    // Feature: when the `searchable` flag actually flips, queue a full
    // Meilisearch reindex as a bulk operation (the `search:reindex` CLI
    // equivalent). The command's event only refreshes Meili's searchable-field
    // settings; a flag flip needs the documents re-pushed so the field
    // starts/stops contributing to matches. Best-effort — a failure to
    // enqueue must not fail the attribute save.
    if (
      req.isSearchable !== undefined &&
      updated.isSearchable !== previousIsSearchable &&
      this.enqueueSearchReindex
    ) {
      try {
        await this.enqueueSearchReindex({
          actorAdminUserId: auditCtx?.actorAdminUserId ?? null,
          attributeKey: updated.key,
        });
      } catch {
        /* enqueue is best-effort — the save already succeeded */
      }
    }
    return updated;
  }

  // --- Read methods (admin lists / detail) --------------------------------

  async listProducts(
    options: {
      includeArchived?: boolean;
      status?: 'active' | 'draft' | 'inactive';
      type?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
      q?: string;
      /** When set, restrict to products in this category or any descendant. */
      categorySlug?: string;
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

    const categoryProductIds = options.categorySlug?.trim()
      ? await this.productIdsInCategoryTree(em, options.categorySlug.trim())
      : null;
    if (categoryProductIds && categoryProductIds.size === 0) {
      // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
      // connection, so the status badges would be counted from outside a
      // transaction the caller holds open while `em.find` above answers from
      // inside it — one screen, two views of `products` (issue #207).
      const countRowsEmpty = (await em.execute(
        `select status, count(*) as count from products where deleted_at is null group by status`,
      )) as Array<{ status: string; count: string | number }>;
      const countsEmpty = { all: 0, active: 0, draft: 0, inactive: 0 };
      for (const row of countRowsEmpty) {
        const n = Number(row.count) || 0;
        countsEmpty.all += n;
        if (row.status === 'active') countsEmpty.active = n;
        else if (row.status === 'draft') countsEmpty.draft = n;
        else if (row.status === 'inactive') countsEmpty.inactive = n;
      }
      return { items: [], page, pageSize, total: 0, counts: countsEmpty };
    }
    if (categoryProductIds) {
      where['id'] = { $in: [...categoryProductIds] };
    }

    let items: Product[];
    let total: number;
    const trimmedQ = options.q?.trim();
    if (trimmedQ || categoryProductIds) {
      // Text search and/or category filter: page via knex, then re-hydrate.
      const knex = em.getKnex();
      const baseQuery = knex('products').where((qb) => {
        qb.whereNull('deleted_at');
        if (options.status) qb.where('status', options.status);
        else if (!options.includeArchived) qb.whereNot('status', 'inactive');
        if (options.type) qb.where('type', options.type);
        if (categoryProductIds) qb.whereIn('id', [...categoryProductIds]);
        if (trimmedQ) {
          const needle = `%${trimmedQ.toLowerCase()}%`;
          qb.andWhere((inner) => {
            inner
              .whereRaw('LOWER("sku") LIKE ?', [needle])
              .orWhereRaw('LOWER("slug") LIKE ?', [needle])
              .orWhereRaw('LOWER("name"::text) LIKE ?', [needle]);
          });
        }
      });
      // Both pages run through `em.execute(builder)` rather than by awaiting
      // the builder: a knex handle carries no transaction context, so the page
      // a caller inside a transaction is shown would be computed from rows that
      // transaction has not written yet (issue #207). The builder is kept
      // rather than rewritten as a statement because the filters above are
      // assembled at runtime; `execute` compiles it and runs it with the
      // EntityManager's transaction context, so the SQL is byte-for-byte the
      // one this method already sent.
      const totalRows = (await em.execute(
        baseQuery.clone().count('* as count'),
      )) as Array<{ count: string | number }>;
      total = Number(totalRows[0]?.count ?? 0);
      const idRows = (await em.execute(
        baseQuery.clone().orderBy('created_at', 'desc').offset(page * pageSize).limit(pageSize).select('id'),
      )) as Array<{ id: string }>;
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
    // `em.execute`, not `em.getKnex()` — same reason as the empty-category
    // branch above.
    const countRows = (await em.execute(
      `select status, count(*) as count from products where deleted_at is null group by status`,
    )) as Array<{ status: string; count: string | number }>;
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

  /**
   * Feature 033 — return all product ids matching list filters (no pagination).
   * Reuses the same filter semantics as {@link listProducts}.
   */
  async resolveProductIds(
    options: {
      includeArchived?: boolean;
      status?: 'active' | 'draft' | 'inactive';
      type?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
      q?: string;
    } = {},
  ): Promise<{ productIds: string[]; total: number }> {
    const maxSelectionSize = Number(process.env['CATALOG_MAX_RESOLVE_IDS'] ?? 10_000);
    const em = this.emFactory();
    const trimmedQ = options.q?.trim();
    const knex = em.getKnex();

    const applyListFilters = (qb: ReturnType<typeof knex>): ReturnType<typeof knex> => {
      // Mirror listProducts: soft-deleted rows are never selectable, and the
      // withdrawn status is `inactive` (feature 032 renamed `archived`).
      qb.whereNull('deleted_at');
      if (options.status) {
        qb.where('status', options.status);
      } else if (!options.includeArchived) {
        qb.whereNot('status', 'inactive');
      }
      if (options.type) {
        qb.where('type', options.type);
      }
      if (trimmedQ) {
        const needle = `%${trimmedQ.toLowerCase()}%`;
        qb.andWhere((inner) => {
          inner
            .whereRaw('LOWER("sku") LIKE ?', [needle])
            .orWhereRaw('LOWER("slug") LIKE ?', [needle])
            .orWhereRaw('LOWER("name"::text) LIKE ?', [needle]);
        });
      }
      return qb;
    };

    // `em.execute(builder)`, not an awaited builder — see `listProducts`
    // (issue #207); the filters are assembled at runtime, so the builder stays
    // and `execute` supplies the EntityManager's transaction context.
    const countRows = (await em.execute(
      applyListFilters(knex('products')).clone().count('* as count'),
    )) as Array<{ count: string | number }>;
    const total = Number(countRows[0]?.count ?? 0);

    if (total > maxSelectionSize) {
      throw new HttpError(
        400,
        ERROR_CODES.SELECTION_TOO_LARGE,
        `Selection matches ${total} products; max ${maxSelectionSize}.`,
        { total, maxSelectionSize },
      );
    }

    const idRows = (await em.execute(
      applyListFilters(knex('products')).clone().orderBy('created_at', 'desc').select('id'),
    )) as Array<{ id: string }>;

    const productIds = idRows.map((r) => r.id);
    return { productIds, total: productIds.length };
  }

  async getProductById(id: string): Promise<Product> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id, deletedAt: null });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    return product;
  }

  /** Category membership ids for admin product editor (feature 031). */
  async getProductCategoryIds(productId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = (await em.execute(
      `select category_id from product_categories where product_id = ?`,
      [productId],
    )) as Array<{ category_id: string }>;
    return rows.map((r) => r.category_id);
  }

  /** Product ids in a category tree (root + descendants), for admin list filters. */
  private async productIdsInCategoryTree(
    em: EntityManager,
    categorySlug: string,
  ): Promise<Set<string>> {
    const root = await em.findOne(Category, { slug: categorySlug, deletedAt: null });
    if (!root) return new Set();

    const all: string[] = [root.id];
    let frontier: string[] = [root.id];
    while (frontier.length > 0) {
      const children = await em.find(Category, {
        parentCategoryId: { $in: frontier },
        deletedAt: null,
      });
      const nextIds = children.map((c) => c.id);
      all.push(...nextIds);
      frontier = nextIds;
    }

    const rows = await em.execute<{ product_id: string }[]>(
      `select product_id from product_categories where category_id in (${all.map(() => '?').join(',')})`,
      all,
    );
    return new Set(rows.map((r) => r.product_id));
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

  async listAttributes(): Promise<CatalogAttributeView[]> {
    // Legacy list ordering was `key ASC`; preserved for the admin surface.
    const views = await this.#requireAttributeRead().listAll();
    return [...views].sort((a, b) => a.key.localeCompare(b.key));
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
  ): Promise<CatalogAttributeView[]> {
    const read = this.#requireAttributeRead();
    // `isRequired` lives on the definition (not an extension column) — filter
    // the composed views. `isMassEditable` is exposed as a separate API flag
    // name; the backing extension field is `massEditable` (no `is` prefix).
    if (flag === 'isRequired') {
      const all = await read.listAll();
      return all
        .filter((v) => v.isRequired)
        .sort((a, b) => a.key.localeCompare(b.key));
    }
    return read.listByFlag(flag === 'isMassEditable' ? 'massEditable' : flag);
  }

  /**
   * Feature 012 / US4 — list every option for one attribute, ordered
   * by sortOrder ASC then value ASC. Backed by `custom_field_options`
   * through the composed view (feature 061); `attributeId` on the result
   * is the attribute (extension) id the admin API has always exposed.
   */
  async listAttributeOptions(attributeId: string): Promise<AttributeOptionResult[]> {
    const attr = await this.getAttributeByIdOrKey(attributeId);
    return [...attr.options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((o) => ({
        id: o.id,
        attributeId: attr.id,
        value: o.value,
        label: o.label,
        labelDefault: o.labelDefault,
        isDefault: o.isDefault,
        sortOrder: o.sortOrder,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      }));
  }

  /** Feature 061 — the option-command target slice of a composed view. */
  #optionCommandTarget(attr: CatalogAttributeView): AttributeOptionCommandTarget {
    return {
      extensionId: attr.id,
      definitionId: attr.customFieldDefinitionId,
      key: attr.key,
      valueType: attr.valueType,
      options: attr.options,
    };
  }

  /** Feature 061 — resolve the attribute whose option list contains `optionId`. */
  async #attributeByOptionId(optionId: string): Promise<CatalogAttributeView> {
    const all = await this.#requireAttributeRead().listAll();
    const attr = all.find((v) => v.options.some((o) => o.id === optionId));
    if (!attr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute option ${optionId} not found.`);
    }
    return attr;
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
  ): Promise<AttributeOptionResult> {
    const attr = await this.getAttributeByIdOrKey(attributeIdOrKey);
    const result = await this.#runCommand(
      createAttributeOptionCommand(
        this.#attributeCommandDeps(),
        this.#optionCommandTarget(attr),
        input,
      ),
    );
    await this.#requireCustomFields().publishInvalidate('product');
    return result;
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
  ): Promise<AttributeOptionResult> {
    const attr = await this.#attributeByOptionId(optionId);
    const result = await this.#runCommand(
      updateAttributeOptionCommand(
        this.#attributeCommandDeps(),
        this.#optionCommandTarget(attr),
        optionId,
        input,
      ),
    );
    await this.#requireCustomFields().publishInvalidate('product');
    return result;
  }

  /** Feature 012 / US4 — remove one option. Refused while products carry it (FR-025). */
  async removeAttributeOption(optionId: string): Promise<void> {
    const attr = await this.#attributeByOptionId(optionId);
    await this.#runCommand(
      deleteAttributeOptionCommand(
        this.#attributeCommandDeps(),
        this.#optionCommandTarget(attr),
        optionId,
      ),
    );
    await this.#requireCustomFields().publishInvalidate('product');
  }

  /**
   * Feature 012 — projection of the legacy `enumValues: string[]` shape
   * from the option rows for one attribute. Returns `null` when the
   * attribute has no options.
   */
  async getAttributeOptionValues(attributeId: string): Promise<string[] | null> {
    const view = await this.#requireAttributeRead().getByIdOrKey(attributeId);
    if (!view || view.options.length === 0) return null;
    return [...view.options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((o) => o.value);
  }

  /** Feature 012 — bulk variant of getAttributeOptionValues for the list endpoint. */
  async getAttributeOptionValuesByIds(
    attributeIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (attributeIds.length === 0) return out;
    const wanted = new Set(attributeIds);
    const all = await this.#requireAttributeRead().listAll();
    for (const view of all) {
      if (!wanted.has(view.id) || view.options.length === 0) continue;
      out.set(
        view.id,
        [...view.options]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
          .map((o) => o.value),
      );
    }
    return out;
  }

  /** Feature 012 — read a single attribute by UUID or snake_case key. */
  async getAttributeByIdOrKey(idOrKey: string): Promise<CatalogAttributeView> {
    const view = await this.#requireAttributeRead().getByIdOrKey(idOrKey);
    if (!view) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Attribute "${idOrKey}" not found.`);
    }
    return view;
  }

  /**
   * Feature 012 — delete an attribute. Refused while any Attribute Set or
   * product still references it (FR-006). The structured error names the
   * dependent rows so the admin UI can guide the operator. Deletes the
   * extension AND the backing definition (+ options cascade) in one
   * transaction (feature 061).
   */
  async deleteAttribute(idOrKey: string): Promise<void> {
    const attr = await this.getAttributeByIdOrKey(idOrKey);
    await this.#runCommand(
      deleteAttributeCommand(this.#attributeCommandDeps(), {
        idOrKey,
        extensionId: attr.id,
        definitionId: attr.customFieldDefinitionId,
        key: attr.key,
        legacyValueType: attr.valueType,
      }),
    );
    await this.#requireCustomFields().publishInvalidate('product');
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
    const variantId = randomUUID();
    const variant = await this.#auditedWrite('product_variant.create', 'product_variant', variantId, async (cem) => {
      const v = cem.create(ProductVariant, {
        id: variantId,
        parentProductId,
        sku: req.sku,
        variantAttributeValues: req.variantAttributeValues,
        ...(req.priceOverride !== undefined
          ? { priceOverride: String(req.priceOverride) }
          : {}),
        ...(req.stockLevel !== undefined ? { stockLevel: req.stockLevel } : {}),
      });
      try {
        await cem.flush();
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
      return { result: v, before: null, after: { parentProductId, sku: req.sku } };
    });
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
    const variant = await this.#auditedWrite('product_variant.update', 'product_variant', variantId, async (em) => {
      const v = await em.findOne(ProductVariant, { id: variantId, parentProductId });
      if (!v) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          `Variant ${variantId} not found under Product ${parentProductId}.`,
        );
      }
      const before = {
        sku: v.sku,
        variantAttributeValues: { ...v.variantAttributeValues },
        priceOverride: v.priceOverride,
        stockLevel: v.stockLevel,
      };
      if (req.variantAttributeValues !== undefined) {
        v.variantAttributeValues = req.variantAttributeValues;
      }
      if (req.priceOverride !== undefined) {
        v.priceOverride = String(req.priceOverride);
      }
      if (req.stockLevel !== undefined) {
        v.stockLevel = req.stockLevel;
      }
      return {
        result: v,
        before,
        after: { sku: v.sku, priceOverride: v.priceOverride, stockLevel: v.stockLevel },
      };
    });
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: parentProductId,
      changedFields: ['variants'],
    });
    return variant;
  }

  async deleteVariant(parentProductId: string, variantId: string): Promise<void> {
    await this.#auditedWrite('product_variant.delete', 'product_variant', variantId, async (em) => {
      const variant = await em.findOne(ProductVariant, { id: variantId, parentProductId });
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
      const before = { parentProductId, sku: variant.sku };
      em.remove(variant);
      return { result: undefined, before, after: null };
    });
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
    // Keys already persisted on the Product. These were validated at their
    // time of write, so re-sending them (e.g. the admin form round-trips the
    // full value map when only the SKU changed, or when the AttributeSet was
    // swapped leaving orphan keys behind) must NOT be rejected — only keys
    // that are genuinely new to this save are checked against the set.
    existingKeys: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (!attributeValues) return;
    const keys = Object.keys(attributeValues);
    if (keys.length === 0) return;

    // Feature 061 — set membership is keyed by definition id; the key lives on
    // the definition, resolved through the composed view (Principle I).
    //
    // `em.execute`, not `em.getConnection().execute`: this guard runs on the
    // Command's `em` inside the create/update transaction, so read on a pooled
    // connection it answered from outside the very transaction it is guarding
    // (issue #207).
    const rows = (await em.execute(
      `select custom_field_definition_id
       from attribute_set_attributes
       where attribute_set_id = ?`,
      [attributeSetId],
    )) as Array<{ custom_field_definition_id: string }>;
    const views = await this.#requireAttributeRead().listAll();
    const keyByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v.key]));
    const allowed = new Set(
      rows
        .map((r) => keyByDefinitionId.get(r.custom_field_definition_id))
        .filter((k): k is string => k !== undefined),
    );

    const rejected = keys.filter(
      (k) =>
        !allowed.has(k) &&
        !existingKeys.has(k) &&
        !VIRTUAL_ATTRIBUTE_VALUE_KEYS.has(k),
    );
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
    // Feature 061 — the required flag lives on the definition (composed view).
    const rows = (await em.execute(
      `select custom_field_definition_id
       from attribute_set_attributes
       where attribute_set_id = ?`,
      [attributeSetId],
    )) as Array<{ custom_field_definition_id: string }>;
    const views = await this.#requireAttributeRead().listAll();
    const viewByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v]));
    const missing = rows
      .map((r) => viewByDefinitionId.get(r.custom_field_definition_id))
      .filter((v): v is CatalogAttributeView => v !== undefined && v.isRequired)
      .map((v) => v.key)
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
    // Feature 061 — membership is definition-keyed; identity fields come from
    // the composed view.
    const views = await this.#requireAttributeRead().listAll();
    const viewByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v]));
    const fetchKeys = async (
      setId: string | null,
    ): Promise<Map<string, { labelDefault: string; isRequired: boolean }>> => {
      const out = new Map<string, { labelDefault: string; isRequired: boolean }>();
      if (!setId) return out;
      const rows = (await em.execute(
        `select custom_field_definition_id
         from attribute_set_attributes
         where attribute_set_id = ?`,
        [setId],
      )) as Array<{ custom_field_definition_id: string }>;
      for (const r of rows) {
        const view = viewByDefinitionId.get(r.custom_field_definition_id);
        if (!view) continue;
        out.set(view.key, { labelDefault: view.labelDefault, isRequired: view.isRequired });
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

  /**
   * A product slug — the value that becomes a storefront URL and sits under
   * `products.slug`'s unique index. Callers go through `allocateUniqueSlug`,
   * which allocates against the live table rather than trusting this to be free.
   *
   * The fold is `slugify` from `@endora-commerce/contracts`, **imported, never
   * re-implemented** (issue #245). The private chain this carried normalised
   * with `NFKD` and stripped the combining marks, which does nothing to `ł` —
   * U+0142 has no canonical decomposition — so the `[^a-z0-9]+` collapse
   * deleted it: `Łączniki` produced `aczniki` and `Wiertła` produced `wiert-a`.
   * Every Polish product name reached the storefront a letter short.
   *
   * **The shared fold is NFD, so this gives up NFKD's compatibility mappings**,
   * and here that is worth stating precisely because the slug is
   * unique-constrained: two names `NFKD` kept apart can now fold together
   * (`Kabel²` and `Kabel³` both give `kabel`). It cannot become a constraint
   * violation — `allocateUniqueSlug` probes the table and suffixes `-2`, `-3`,
   * … exactly as it already does for two products sharing a plain name — and
   * the characters that can cause it (`ﬁ`, superscripts, full-width forms) are
   * not typed into product names, while `ł` is in most of them.
   *
   * Slugs already stored are **not** migrated (owner's ruling, 2026-08-19).
   * Nothing re-derives a slug to find an existing product: this runs on create
   * and on duplicate, and duplicate re-slugs an already-slugged string.
   */
  private slugify(value: string): string {
    return slugifyText(value, { maxLength: 160 });
  }

  private anyValue(blob: Record<string, string>): string {
    const key = Object.keys(blob)[0];
    return key ? (blob[key] ?? '') : '';
  }
}
