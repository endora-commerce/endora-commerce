import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  isOrderMinimumEligibleType,
  isValidOrderMinimum,
  PRICE_FIELDS_REFUSED_ON_PRODUCTS,
  // Aliased: the private method below keeps the name, so the shared function
  // needs one the class body cannot shadow.
  slugify as slugifyText,
  type AdminAttributeUsage,
  type CatalogAdminAuditContext,
  type CreateAttributeRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type UpdateAttributeRequest,
  type UpdateProductRequest,
  type ProductArchivedMode,
  type ProductStatus,
  type ScopeCompletenessGateMode,
  type ScopeWarning,
  type UpdateVariantRequest,
  uuidSchema,
} from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';

export interface CatalogEvents extends Record<string, EventBase> {
  'product.created.v1': EventBase & { productId: string; sku: string };
  'product.updated.v1': EventBase & { productId: string; changedFields: string[] };
  'product.archived.v1': EventBase & { productId: string };
  /**
   * `formerUrlKeys` (feature 163, T155 CACHE-1) — the redirect keys the deletion
   * removed, so a subscriber dropping the product's cached pages can still name them.
   */
  'product.deleted.v1': EventBase & { productId: string; formerUrlKeys?: string[] };
  'attribute.updated.v1': EventBase & {
    attributeKey: string;
    isSearchable: boolean;
    isFilterable: boolean;
  };
  /**
   * Feature 172 (research R-9) — one product × content attribute value was
   * saved, and nothing else of the product changed. A separate event rather
   * than a cause of `product.updated.v1`, because that one is what `search`,
   * `seo` and `price_lists` react to, and a content document is on none of
   * their projections: saving a paragraph drops the product's storefront page
   * cache and re-indexes nothing (FR-035).
   */
  'product.content.updated.v1': EventBase & { productId: string; attributeKey: string };
}

export type CatalogEventBus = EventBus<CatalogEvents>;

/** Feature 163 (R30.4) — the admin product list's tab badges. */
export interface ProductListCounts {
  all: number;
  active: number;
  inactive: number;
  archived: number;
}

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

/**
 * Feature 174 (FR-119, T151) — `seo`'s product metadata copied at every scope a duplicate's
 * source holds, through `seo`'s write port **on the duplicate Command's em** (no audit of its
 * own: the duplicate's entry covers it). Presence is decided by the wiring in front of the port;
 * with `seo` off the copy is skipped and the answer is `'not-present'` — a duplicate nobody asked
 * SEO of is not refused for it (Principle XVII).
 */
export type CatalogSeoProductMetaCopy = (
  em: EntityManager,
  input: { sourceProductId: string; targetProductId: string },
) => Promise<{ copied: number } | 'not-present'>;
import { HttpError } from '@endora-commerce/platform/http';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductUrlRedirect } from '../entities/product-url-redirect.entity.js';
import { allocateFreeSlug } from './url-key.service.js';
import { bumpScopeVersion } from './scoped-values-state.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { globalScopeFields } from './product-availability.service.js';
import { toChannelRecord, toLanguageRecord } from './product-scopes.service.js';
import type { ScopeCompletenessGate } from './scope-completeness.js';
import {
  assertVirtualDownloadFields,
  ProductTypeValidationError,
} from './product-type-validations.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
// D-77 — the apply seam is named once in this module, by `attribute-commands.ts`
// (see the re-export there for why it is a re-export and not a local
// declaration). This file takes it as it is: since T053(b) the write path
// widens it with nothing.
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
import { requireLinkableAsset, type LinkableAssetReader } from './linkable-asset.js';
import {
  attributeSetExists,
  findSkuHolder,
  missingCategoryIds,
  missingRequiredAttributeKeys,
  PRODUCT_SKU_MAX,
  reconcileProductCategories,
} from './product-global-field-rules.js';
import { assertNoContentAttributeValues } from './content-attribute-rules.js';
import { readAttributeUsage } from './attribute-usage.js';

// Feature 061 — the API-form mapping helpers moved next to the R7 map; the
// re-exports keep the long-standing import site (routes, tests) stable.
export { dbToApiAttributeType, resolveAttributeApiType } from './attribute-type-mapping.js';


/**
 * How many free-looking slug candidates `allocateUniqueSlug` locks at once (Phase 16
 * review): enough that a concurrent writer winning one does not fail the allocation.
 */
const SLUG_CANDIDATE_LOCKS = 3;

/*
 * `CatalogCustomFieldsPort` used to stand here — this module's own widening of
 * `custom_fields`' apply seam with one extra method, `getById`. T053(b)
 * removed it in both directions: the widening was a **read**, which now names
 * `CustomFieldDefinitionReadPort.getById` through the read model, and what the
 * write path takes from the owner is exactly the apply seam and nothing
 * around it. A consumer widening another module's published shape is the form
 * D-97.3 refuses at the optional member; a required one is quieter and no
 * better founded — the owner declares its port, and `lazyPort<T>` is an
 * unchecked cast, so a method the consumer adds is a method nothing verifies.
 */

/**
 * Optional metadata used to attach audit entries to admin mutations.
 *
 * Published as `CatalogAdminAuditContext` in feature 075's Phase P — the
 * write port's two audited methods take it — and aliased back here so the two
 * cannot drift.
 */
export type AdminAuditContext = CatalogAdminAuditContext;

/**
 * Feature 160 (FR-043) — a product has no price of its own: a price is a row of
 * a price book (D-287 §5.8). The old *default price* keys of `attributeValues`
 * are refused on every write rather than stored where nothing reads them, with
 * a code that says where prices are set. Exported for the routes, which refuse
 * the same names at the top level of an old client's body.
 */
export function refusePriceFields(fields: Readonly<Record<string, unknown>> | undefined, pathPrefix = ''): void {
  if (!fields) return;
  const named = PRICE_FIELDS_REFUSED_ON_PRODUCTS.filter((key) => Object.prototype.hasOwnProperty.call(fields, key));
  if (named.length === 0) return;
  throw new HttpError(
    400,
    ERROR_CODES.PRICE_SET_IN_PRICE_BOOKS,
    'Prices are set in price books, not on the product.',
    named.map((key) => ({ path: `${pathPrefix}${key}`, issue: 'prices are set in price books' })),
  );
}

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

/**
 * Feature 163 (FR-060) — an operator's write asking for the completeness gate: the
 * mode read once for the request, and where to put the warnings of `warn`. Absent, the
 * write is not gated (imports, connectors, the API-key upsert — A-6).
 */
export interface ProductUpdateGate {
  completeness?: ScopeCompletenessGateMode | undefined;
  /** Receives the `completeness` warnings in `warn` mode. */
  warnings?: ScopeWarning[];
  /**
   * Feature 163 (S-W3) — the API key an integration wrote through, recorded in the
   * audit entry's after-state (the entry has no API-key column; the Command derives
   * its actor from the ambient context, whose admin id is `null` for a key).
   */
  apiKeyId?: string | null | undefined;
}

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
     * Feature 061 — the custom_fields transactional apply seam. Required for
     * attribute/option mutations. The committed-state definition read it used
     * to carry alongside them is `attributeRead`'s since T053(b).
     */
    private readonly customFields?: CustomFieldDefinitionApplyApi,
    /**
     * Issue #185 — `inventory`'s per-warehouse threshold copy, presence-decided
     * by the wiring. Optional for the same reason every collaborator above it
     * is: fixtures that duplicate a product without an inventory composition
     * keep constructing this service, and a duplicate with no thresholds copied
     * is the module's declared degrade rather than a failure.
     */
    private readonly copyWarehouseThresholds?: CatalogWarehouseThresholdCopy,
    /**
     * Feature 163 (FR-060, FR-061) — the completeness gate for an operator's change of
     * the global status. Composed into the admin routes' instance only; it runs only
     * when a call passes a mode ({@link ProductUpdateGate}), so the integration ports
     * and the API-key upsert, which never do, are never gated (A-6).
     */
    private readonly completenessGate?: ScopeCompletenessGate,
    /**
     * Feature 166 (FR-006) — `assets_library`'s read port, asked before a
     * download file is linked. Optional so fixtures without the library keep
     * constructing the service; a create that names a file without it fails
     * closed ({@link CatalogAdminService.#requireAssets}).
     */
    private readonly assets?: LinkableAssetReader,
    /** Feature 174 (FR-119) — `seo`'s metadata copy for a duplicate, presence-decided by the wiring. */
    private readonly copySeoProductMeta?: CatalogSeoProductMetaCopy,
  ) {}

  #requireAssets(): LinkableAssetReader {
    if (!this.assets) {
      throw new Error('CatalogAdminService: the asset read port is not wired — a download file cannot be linked.');
    }
    return this.assets;
  }

  /** The gate's mode for an operator's write, read once per request; `undefined` where no gate is composed. */
  async completenessMode(): Promise<ScopeCompletenessGateMode | undefined> {
    return this.completenessGate?.mode();
  }

  /**
   * Feature 172 (FR-014) — the early refusal of a content attribute's key on a
   * product write, before any row is read or a transaction opened. Reads the
   * attribute model only when the write carries attribute values at all.
   */
  async #refuseContentAttributeValues(attributeValues: Record<string, unknown> | undefined): Promise<void> {
    if (!attributeValues || Object.keys(attributeValues).length === 0) return;
    assertNoContentAttributeValues(attributeValues, await this.#requireAttributeRead().listAll());
  }

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'CatalogAdminService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  #requireCustomFields(): CustomFieldDefinitionApplyApi {
    if (!this.customFields) {
      throw new Error(
        'CatalogAdminService: the custom_fields definition port is not wired — attribute writes are unavailable.',
      );
    }
    return this.customFields;
  }

  #attributeCommandDeps(): AttributeCommandDeps {
    const read = this.#requireAttributeRead();
    return {
      apply: this.#requireCustomFields(),
      // T053(b) — the definition read comes off the published read port, not
      // off the apply seam. Two collaborators rather than one because they are
      // two questions: a co-transactional write that must take the caller's
      // `EntityManager`, and a committed-state read that must not.
      readDefinition: (id) => read.getDefinitionById(id),
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
    refusePriceFields(req.attributeValues as Record<string, unknown> | undefined, 'attributeValues.');
    // Feature 172 (FR-014) — refused before the Command opens a transaction;
    // the set guard inside it refuses the same keys again for every other path.
    await this.#refuseContentAttributeValues(req.attributeValues as Record<string, unknown> | undefined);
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
    // Feature 155 (FR-001, D5) — the range and the type rule hold for every
    // caller, not only for the ones a route schema stands in front of.
    assertOrderMinimumAllowed(req.type, req.minOrderQuantity);
    // Feature 166 (FR-006) — a download file the caller may not see answers
    // as a missing one, and is never linked.
    if (req.downloadAssetId) await requireLinkableAsset(this.#requireAssets(), req.downloadAssetId);

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
        const slug = await this.allocateUniqueSlug(em, req.name || req.sku);
        const product = em.create(Product, {
          id: productId,
          sku: req.sku,
          slug,
          type: req.type,
          // Feature 163 (Q1-d) — a product starts switched off.
          status: req.status ?? 'inactive',
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
          // Feature 155 (FR-001, FR-003) — the order rules, when the request names them.
          ...(req.minOrderQuantity !== undefined ? { minOrderQuantity: req.minOrderQuantity } : {}),
          ...(req.returnable !== undefined ? { returnable: req.returnable } : {}),
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
        // `categoryIds` is a required field of the create request. The bridge
        // rows are written here, after the flush that makes the product row
        // exist for their foreign key and on the Command's own `em`, so they
        // commit or roll back with the product and `product.created.v1` is
        // only ever emitted for a product whose categories are already there.
        // A product that has just been created has no rows to reconcile
        // against, so an empty list is no statement at all.
        const categoryIds = [...new Set(req.categoryIds ?? [])];
        if (categoryIds.length > 0) {
          await this.#reconcileProductCategories(em, product.id, categoryIds);
        }
        return {
          result: product,
          after: {
            sku: product.sku,
            name: product.name,
            status: product.status,
            visibility: product.visibility,
            stockMode: product.stockMode,
            categoryIds,
            minOrderQuantity: product.minOrderQuantity ?? null,
            returnable: product.returnable,
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
    gate?: ProductUpdateGate,
  ): Promise<Product> {
    const em = this.emFactory();
    const r = await this.#applyProductUpdate(em, id, req, gate);
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
    // Feature 163 (FR-010) — a status write never archives, so this write has
    // one announcement; `product.archived.v1` belongs to the Archive action.
    this.events.emit('product.updated.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: r.product.id,
      changedFields: r.changedFields,
    });
    return r.product;
  }

  /** The completeness gate for `product`'s global status going to `status` (FR-060). */
  async #gateGlobalStatus(
    em: EntityManager,
    product: Product,
    status: ProductStatus,
    mode: ScopeCompletenessGateMode,
  ): Promise<ScopeWarning[]> {
    const gate = this.completenessGate!;
    const [channelRows, languageRows, channels] = await Promise.all([
      em.find(ProductChannelScope, { productId: product.id }),
      em.find(ProductChannelLanguageScope, { productId: product.id }),
      gate.memberChannels(product.id),
    ]);
    const before = {
      global: globalScopeFields(product),
      channelRows: channelRows.map(toChannelRecord),
      languageRows: languageRows.map(toLanguageRecord),
    };
    const after = { ...before, global: { ...before.global, status } };
    return gate.enforce(em, product, before, after, channels, mode);
  }

  /**
   * `product.archived.v1` — the product was archived by the Archive action
   * (feature 163, FR-019). Emitted by {@link archiveProduct} alone, after the
   * write has committed and after its `product.updated.v1` `['archivedAt']`,
   * inside the event scope that method opens. Once per transition: archiving an
   * archived product announces nothing.
   */
  #emitArchived(productId: string): void {
    this.events.emit('product.archived.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId,
    });
  }

  /**
   * Feature 054 — admin single-update path, audited co-transactionally via the
   * Command Bus (one audit row + the event on commit, none on rollback). Falls
   * back to the legacy `updateProduct` when no bus is injected (bus-less tests).
   */
  async updateProductAudited(id: string, req: UpdateProductRequest, gate?: ProductUpdateGate): Promise<Product> {
    // Feature 172 (FR-014) — before the transaction, as on create.
    await this.#refuseContentAttributeValues(req.attributeValues as Record<string, unknown> | undefined);
    if (!this.commandBus) return this.updateProduct(id, req, undefined, gate);
    return this.commandBus.run(this.#updateProductCommand(id, req, gate));
  }

  #updateProductCommand(id: string, req: UpdateProductRequest, gate?: ProductUpdateGate): Command<Product> {
    let changedFields: string[] = [];
    return {
      action: 'product.update',
      objectType: 'product',
      objectId: id,
      run: async ({ em }) => {
        const r = await this.#applyProductUpdate(em, id, req, gate);
        changedFields = r.changedFields;
        return {
          result: r.product,
          before: r.stateBefore,
          after: { ...r.stateAfter, changedFields, ...(gate?.apiKeyId ? { apiKeyId: gate.apiKeyId } : {}) },
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
    gate?: ProductUpdateGate,
  ): Promise<{
    product: Product;
    stateBefore: Record<string, unknown>;
    stateAfter: Record<string, unknown>;
    changedFields: string[];
  }> {
    refusePriceFields(req.attributeValues as Record<string, unknown> | undefined, 'attributeValues.');
    const product = await em.findOne(Product, { id });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    // Feature 155 (FR-001, D5) — refused before anything on the row changes.
    assertOrderMinimumAllowed(product.type, req.minOrderQuantity);
    // Feature 174 (C2/C3 code review 1) — the existence rules the scoped save holds for the same
    // Global-only fields (`product-global-field-rules.ts`), checked before anything is written:
    // an unknown attribute set or an unknown or deleted category used to reach the foreign key
    // (a 500), and a deleted category was linked silently.
    if (
      req.attributeSetId !== undefined &&
      req.attributeSetId !== product.attributeSetId &&
      !(await attributeSetExists(em, req.attributeSetId))
    ) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'unknown_attribute_set');
    }
    if (req.categoryIds !== undefined) {
      const missing = await missingCategoryIds(em, req.categoryIds);
      if (missing.length > 0) {
        throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `unknown_category_ids: ${missing.join(', ')}`);
      }
    }
    // Feature 174 (R7, contract §6) — a product-row write is Save-overwritable: it moves the
    // editor's version, and a `version` the caller sends is compared first (stale → 409).
    await bumpScopeVersion(em, id, req.version);
    const stateBefore: Record<string, unknown> = {
      sku: product.sku,
      name: product.name,
      description: product.description,
      stockMode: product.stockMode,
      visibility: product.visibility,
      status: product.status,
      archivedAt: product.archivedAt ?? null,
      attributeValues: { ...product.attributeValues },
      allowedOrganizationIds: [...product.allowedOrganizationIds],
      // Feature 155 (FR-005) — always present, so a row records the value
      // whether or not this write touched it.
      minOrderQuantity: product.minOrderQuantity ?? null,
      returnable: product.returnable,
      // Feature 163 (FR-023) — the global publication window.
      publishFrom: product.publishFrom?.toISOString() ?? null,
      publishUntil: product.publishUntil?.toISOString() ?? null,
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
      if (trimmed.length === 0 || trimmed.length > PRODUCT_SKU_MAX) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'invalid_sku',
        );
      }
      // Feature 025 — SKUs share a global namespace with variants (see createVariant).
      const holder = await findSkuHolder(em, product.id, trimmed);
      if (holder) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'productId' in holder
            ? `sku_in_use { conflictingProductId: ${holder.productId}, conflictingSku: ${trimmed} }`
            : `sku_in_use { conflictingVariantId: ${holder.variantId}, conflictingSku: ${trimmed} }`,
        );
      }
      product.sku = trimmed;
      changedFields.push('sku');
    }
    if (req.name) { product.name = req.name; changedFields.push('name'); }
    if (req.description) { product.description = req.description; changedFields.push('description'); }
    if (req.stockMode !== undefined) { product.stockMode = req.stockMode; changedFields.push('stockMode'); }
    if (req.visibility) { product.visibility = req.visibility; changedFields.push('visibility'); }
    // Feature 022 — status field. Feature 163 (FR-010, FR-019, O-5): a status
    // write never sets or clears `archivedAt` — `inactive` is plain off and
    // `active` does not restore. Archiving is the Archive / Restore action.
    if (req.status !== undefined && req.status !== product.status) {
      // Feature 163 (FR-060, US6 #3) — a change of the global switch runs the
      // completeness gate over every pair it turns on, before the row changes: in
      // `refuse` one failing pair refuses the whole write (N3). It reads status
      // only, so an archived product set `active` is gated too.
      if (gate?.completeness && this.completenessGate) {
        const warnings = await this.#gateGlobalStatus(em, product, req.status, gate.completeness);
        gate.warnings?.push(...warnings);
      }
      product.status = req.status;
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
      const changed = await this.#reconcileProductCategories(em, product.id, req.categoryIds);
      if (changed) {
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
    // Feature 155 (FR-001, FR-003, D5) — the pieces minimum and the returnable flag.
    if (req.minOrderQuantity !== undefined) {
      product.minOrderQuantity = req.minOrderQuantity;
      changedFields.push('minOrderQuantity');
    }
    if (req.returnable !== undefined) {
      product.returnable = req.returnable;
      changedFields.push('returnable');
    }
    // Feature 163 (FR-023) — the global publication window, written as a pair:
    // an omitted bound keeps its stored value, and the pair that results must
    // start before it ends. It never touches a channel's window (FR-013).
    if (req.publishFrom !== undefined || req.publishUntil !== undefined) {
      const from =
        req.publishFrom === undefined
          ? (product.publishFrom ?? null)
          : req.publishFrom === null
            ? null
            : new Date(req.publishFrom);
      const until =
        req.publishUntil === undefined
          ? (product.publishUntil ?? null)
          : req.publishUntil === null
            ? null
            : new Date(req.publishUntil);
      if (from !== null && until !== null && from.getTime() >= until.getTime()) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'The publication window must start before it ends.',
          { field: 'window' },
        );
      }
      if (
        (from?.getTime() ?? null) !== (product.publishFrom?.getTime() ?? null) ||
        (until?.getTime() ?? null) !== (product.publishUntil?.getTime() ?? null)
      ) {
        product.publishFrom = from;
        product.publishUntil = until;
        changedFields.push('publicationWindow');
      }
    }
    const stateAfter: Record<string, unknown> = {
      name: product.name,
      description: product.description,
      stockMode: product.stockMode,
      visibility: product.visibility,
      status: product.status,
      archivedAt: product.archivedAt ?? null,
      attributeValues: { ...product.attributeValues },
      allowedOrganizationIds: [...product.allowedOrganizationIds],
      minOrderQuantity: product.minOrderQuantity ?? null,
      returnable: product.returnable,
      publishFrom: product.publishFrom?.toISOString() ?? null,
      publishUntil: product.publishUntil?.toISOString() ?? null,
    };
    return { product, stateBefore, stateAfter, changedFields };
  }

  /**
   * Makes `product_categories` hold exactly `categoryIds` for one product, on
   * the caller's `em` and inside its transaction: the current rows are read,
   * and only the difference is deleted or inserted. Returns whether anything
   * was written.
   *
   * The one writer of that bridge for both the create Command and the update
   * path, so a product's categories commit, roll back and are audited with the
   * write that named them. A repeated id is one membership: the bridge's
   * primary key is the pair, and an unfiltered insert would turn a duplicate
   * in the request into a constraint violation.
   */
  async #reconcileProductCategories(
    em: EntityManager,
    productId: string,
    categoryIds: readonly string[],
  ): Promise<boolean> {
    return reconcileProductCategories(em, productId, categoryIds);
  }

  /**
   * Duplicate an existing Product: copies the core row plus bridge tables
   * (categories, sales-channel memberships, gallery items + labels,
   * attachments, packaging units, related/up-sell/cross-sell links, grouped
   * children, bundle slots + options, variants) and, since feature 174
   * (FR-119), every scoped value at Global, Channel and Channel × language.
   *
   * The duplicated row gets a fresh UUID; the SKU is derived from the
   * source by appending `-copy`, then `-copy-2`, `-copy-3`, … until a
   * free slot is found. Status is reset to `'inactive'` and `archivedAt`
   * is cleared (feature 163, Q1-d) so the operator can review before
   * switching it on — also when the source is archived and `active`.
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
    // Unaudited without a Command Bus, but still one transaction: the URL-key
    // advisory locks a write takes (`allocateUniqueSlug`) hold only inside one.
    return this.emFactory().transactional(async (em) => {
      const w = await write(em);
      await em.flush();
      return w.result;
    });
  }

  async duplicateProduct(id: string): Promise<Product> {
    const em = this.emFactory();
    const source = await em.findOne(Product, { id });
    if (!source) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // Feature 174 (FR-119, T151) — the copy is ONE Command: the product row, every catalog-owned
    // bridge and every scoped value at Global, Channel and Channel × language, empty overrides and
    // inherit states included, commit or roll back together with the one audit entry. What other
    // modules own runs through their own audited Commands after it (the channel memberships, the
    // warehouse thresholds): a Command cannot nest inside another's transaction. URL keys are never
    // copied beyond the fresh Global key, and status is reset at every scope (163 Q1-d).
    const dupId = randomUUID();
    const dup = await this.#auditedWrite('product.duplicate', 'product', dupId, async (cem) => {
      // Inside the Command's transaction (Phase 16 review): the slug's URL-key lock is
      // a transaction lock, so on a bare em it was released before the insert.
      const newSku = await this.allocateCopySku(cem, source.sku);
      const newSlug = await this.allocateCopySlug(cem, source.slug);
      const created = cem.create(Product, {
        id: dupId,
        sku: newSku,
        slug: newSlug,
        type: source.type,
        status: 'inactive',
        archivedAt: null,
        name: this.suffixCopyName(source.name),
        description: source.description,
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
        // Feature 174 (FR-119) — the Global order rules and publication window.
        minOrderQuantity: source.minOrderQuantity ?? null,
        returnable: source.returnable,
        publishFrom: source.publishFrom ?? null,
        publishUntil: source.publishUntil ?? null,
      });
      await cem.flush();
      const copied = await this.#copyCatalogRows(cem, source, dupId);
      const seo = this.copySeoProductMeta
        ? await this.copySeoProductMeta(cem, { sourceProductId: source.id, targetProductId: dupId })
        : 'not-present';
      // Feature 172 (FR-060, research R-16) — the product's Page Builder content
      // is copied in this transaction, atomic with the row it belongs to. The
      // audit row counts the attributes, never the documents.
      const copiedContent = (await cem.execute(
        `insert into product_content_values
           (id, product_id, product_attribute_id, content, summary, created_at, updated_at)
         select gen_random_uuid(), ?, product_attribute_id, content, summary, now(), now()
           from product_content_values where product_id = ?
         returning id`,
        [dupId, source.id],
      )) as Array<{ id: string }>;
      return {
        result: created,
        before: null,
        after: {
          sku: newSku,
          slug: newSlug,
          sourceProductId: id,
          copied: { ...copied, seoScopes: seo === 'not-present' ? null : seo.copied },
          contentAttributeCount: copiedContent.length,
        },
      };
    });

    // The channel assortment, through the kernel's membership service (issue
    // #185). This was an `insert … select` against the bridge table, which is
    // Principle XII's accessor clause and Principle XIII in one statement: the
    // bridge was written directly and not one of the memberships the duplicate
    // gained was audited. `copyMemberships` adds them one audited call at a
    // time.
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.copyMemberships('product', source.id, dup.id);
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

    this.events.emit('product.created.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId: dup.id,
      sku: dup.sku,
    });

    return dup;
  }

  /**
   * Feature 174 (FR-119, T151) — every catalog-owned row of `source` copied onto `targetId`, on the
   * Command's em: the bridges (categories, gallery with its Global roles, attachments, packaging
   * units, links, grouped children, bundle slots, variants) and every scoped value at Channel and
   * Channel × language — value overrides (texts and attributes), channel scope rows, gallery item,
   * gallery role, attachment and packaging-unit overrides — verbatim, so a deliberately empty
   * override stays empty and a scope holding nothing still inherits. Child-row overrides are
   * re-pointed through an old → new id map passed as one JSON parameter.
   *
   * Not copied: URL keys and redirects (unique per channel; the copy has its fresh Global key),
   * status at Channel and Channel × language (the copy starts `inactive` everywhere, 163 Q1-d).
   * Orphaned rows (a scope the source no longer sells on) are copied like the rest: they keep
   * what the source keeps, and come back to life in the same way when the scope does.
   */
  async #copyCatalogRows(em: EntityManager, source: Product, targetId: string): Promise<Record<string, number>> {
    const count = async (sql: string, params: unknown[]): Promise<number> =>
      ((await em.execute(sql, params)) as unknown[]).length;
    const idMap = async (table: string): Promise<Record<string, string>> => {
      const rows = (await em.execute(`select "id" from "${table}" where "product_id" = ?`, [source.id])) as Array<{
        id: string;
      }>;
      return Object.fromEntries(rows.map((row) => [row.id, randomUUID()]));
    };
    const remap = (column: string) => `(?::jsonb ->> o."${column}"::text)::uuid`;

    // product_categories (bridge)
    await em.execute(
      `insert into "product_categories" ("product_id", "category_id")
         select ?, "category_id" from "product_categories" where "product_id" = ?`,
      [targetId, source.id],
    );

    // Texts and attributes at C and C×L.
    const valueOverrides = await count(
      `insert into "product_value_overrides"
         ("id", "product_id", "attribute_key", "channel_id", "language_code", "value", "created_at", "updated_at")
         select gen_random_uuid(), ?, o."attribute_key", o."channel_id", o."language_code", o."value", now(), now()
           from "product_value_overrides" o where o."product_id" = ?
         returning "id"`,
      [targetId, source.id],
    );

    // Window, audience, MOQ and returnable at C; status inherits (the copy is reviewed first).
    const channelScopes = await count(
      `insert into "product_channel_scopes"
         ("product_id", "sales_channel_id", "status", "window_overridden", "publish_from", "publish_until",
          "visibility", "allowed_organization_ids", "min_order_quantity_overridden", "min_order_quantity",
          "returnable", "created_at", "updated_at")
         select ?, o."sales_channel_id", null, o."window_overridden", o."publish_from", o."publish_until",
                o."visibility", o."allowed_organization_ids", o."min_order_quantity_overridden",
                o."min_order_quantity", o."returnable", now(), now()
           from "product_channel_scopes" o where o."product_id" = ?
         returning "product_id"`,
      [targetId, source.id],
    );

    // Gallery: the items with their Global alt text and hidden flag, the Global roles, the overrides.
    const items = await idMap('gallery_items');
    const itemsJson = JSON.stringify(items);
    const galleryItems = await count(
      `insert into "gallery_items" ("id", "product_id", "asset_id", "position", "alt_text", "hidden", "created_at", "updated_at")
         select ${remap('id')}, ?, o."asset_id", o."position", o."alt_text", o."hidden", now(), now()
           from "gallery_items" o where o."product_id" = ?
         returning "id"`,
      [itemsJson, targetId, source.id],
    );
    const galleryRoles = await count(
      `insert into "gallery_item_labels" ("gallery_item_id", "product_id", "label")
         select ${remap('gallery_item_id')}, ?, o."label"
           from "gallery_item_labels" o where o."product_id" = ?
         returning "label"`,
      [itemsJson, targetId, source.id],
    );
    const galleryItemOverrides = await count(
      `insert into "gallery_item_scope_overrides"
         ("id", "gallery_item_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
         select gen_random_uuid(), ${remap('gallery_item_id')}, ?, o."sales_channel_id", o."language_code", o."field", o."value", now(), now()
           from "gallery_item_scope_overrides" o where o."product_id" = ?
         returning "id"`,
      [itemsJson, targetId, source.id],
    );
    // An empty role (no holder) keeps its `null`: `->>` of a null key is null.
    const galleryRoleOverrides = await count(
      `insert into "gallery_role_scope_overrides"
         ("id", "product_id", "sales_channel_id", "language_code", "label", "gallery_item_id", "created_at", "updated_at")
         select gen_random_uuid(), ?, o."sales_channel_id", o."language_code", o."label", ${remap('gallery_item_id')}, now(), now()
           from "gallery_role_scope_overrides" o where o."product_id" = ?
         returning "id"`,
      [targetId, itemsJson, source.id],
    );

    // Attachments with their Global hidden flag, then their overrides.
    const attachmentIds = JSON.stringify(await idMap('product_attachments'));
    const attachments = await count(
      `insert into "product_attachments"
         ("id", "product_id", "asset_id", "attachment_type_id", "name", "description", "position", "hidden", "created_at", "updated_at")
         select ${remap('id')}, ?, o."asset_id", o."attachment_type_id", o."name", o."description", o."position", o."hidden", now(), now()
           from "product_attachments" o where o."product_id" = ?
         returning "id"`,
      [attachmentIds, targetId, source.id],
    );
    const attachmentOverrides = await count(
      `insert into "product_attachment_scope_overrides"
         ("id", "attachment_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
         select gen_random_uuid(), ${remap('attachment_id')}, ?, o."sales_channel_id", o."language_code", o."field", o."value", now(), now()
           from "product_attachment_scope_overrides" o where o."product_id" = ?
         returning "id"`,
      [attachmentIds, targetId, source.id],
    );

    // Packaging units, then their name overrides.
    const unitIds = JSON.stringify(await idMap('product_packaging_units'));
    const packagingUnits = await count(
      `insert into "product_packaging_units"
         ("id", "product_id", "name", "base_quantity", "position", "is_default", "min_order_units", "created_at", "updated_at")
         select ${remap('id')}, ?, o."name", o."base_quantity", o."position", o."is_default", o."min_order_units", now(), now()
           from "product_packaging_units" o where o."product_id" = ?
         returning "id"`,
      [unitIds, targetId, source.id],
    );
    const packagingUnitOverrides = await count(
      `insert into "product_packaging_unit_scope_overrides"
         ("id", "packaging_unit_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
         select gen_random_uuid(), ${remap('packaging_unit_id')}, ?, o."sales_channel_id", o."language_code", o."field", o."value", now(), now()
           from "product_packaging_unit_scope_overrides" o where o."product_id" = ?
         returning "id"`,
      [unitIds, targetId, source.id],
    );

    // product_links (only outgoing links are copied — incoming links from
    // other products toward the source product stay attached to the source)
    await em.execute(
      `insert into "product_links"
         ("id", "source_product_id", "target_product_id", "kind", "position", "created_at", "updated_at")
         select gen_random_uuid(), ?, "target_product_id", "kind", "position", now(), now()
           from "product_links" where "source_product_id" = ?`,
      [targetId, source.id],
    );

    // grouped_items (children of a grouped product)
    if (source.type === 'grouped') {
      await em.execute(
        `insert into "grouped_items"
           ("id", "parent_product_id", "child_product_id", "quantity", "position", "created_at", "updated_at")
           select gen_random_uuid(), ?, "child_product_id", "quantity", "position", now(), now()
             from "grouped_items" where "parent_product_id" = ?`,
        [targetId, source.id],
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
            targetId,
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

    // product_variants (configurable products) — each variant has its own
    // unique SKU; we allocate copies the same way as the parent SKU.
    if (source.type === 'configurable') {
      const variants = await em.find(ProductVariant, { parentProductId: source.id });
      for (const v of variants) {
        const variantSku = await this.allocateCopySku(em, v.sku);
        const newVariant = em.create(ProductVariant, {
          parentProductId: targetId,
          sku: variantSku,
          variantAttributeValues: { ...v.variantAttributeValues },
          ...(v.stockLevel != null ? { stockLevel: v.stockLevel } : {}),
        });
        em.persist(newVariant);
      }
      await em.flush();
    }

    return {
      valueOverrides,
      channelScopes,
      galleryItems,
      galleryItemOverrides,
      galleryRoles,
      galleryRoleOverrides,
      attachments,
      attachmentOverrides,
      packagingUnits,
      packagingUnitOverrides,
    };
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
   *
   * Feature 163 (A-11) — a new product's slug is its key in every language, so
   * "free" means free as a URL key: no product's global key, and no live
   * product's current or redirecting key in any language.
   *
   * Must run inside the caller's transaction (the Command's): the decisive check is
   * made under the candidates' URL-key locks, which are transaction locks. The first
   * {@link SLUG_CANDIDATE_LOCKS} candidates that look free without a lock are locked
   * together, **once and in sorted order** — the order every key writer locks in, so
   * the two cannot deadlock — and re-checked under the locks in index order; the first
   * still free wins. A held lock is never released before the transaction ends, so
   * locking candidates one at a time after a lost race would acquire them out of
   * sorted order (`root-10` sorts before `root-9`). Losing every candidate of the set
   * to concurrent writers is refused like an exhausted search.
   */
  private async allocateUniqueSlug(em: EntityManager, source: string): Promise<string> {
    const root = this.slugify(source);
    const candidates = Array.from({ length: 1000 }, (_, i) => (i === 0 ? root : this.slugify(`${root}-${i + 1}`)));
    // Feature 174 (T039) — the URL-key service's allocation: probe, lock in sorted order, re-check.
    const slug = await allocateFreeSlug(em, candidates, SLUG_CANDIDATE_LOCKS);
    if (slug !== null) return slug;
    throw new HttpError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      `Could not allocate a unique slug derived from "${source}".`,
    );
  }

  /**
   * Feature 174 — the copy's Global name with a "(copy)" suffix, so the duplicate is obviously a
   * clone in lists. Its Channel and Channel × language names are copied verbatim (FR-119).
   */
  private suffixCopyName(name: string): string {
    return name.trim() === '' ? name : `${name} (copy)`.slice(0, 255);
  }

  /**
   * Feature 163 (FR-019, research R30.3) — Archive one product: the `product.archive`
   * Command sets `archivedAt` and touches no status at any scope, and no
   * completeness gate runs. Announces `product.updated.v1` `['archivedAt']`, then
   * `product.archived.v1`, both after commit and in that order (one event scope,
   * dispatched in order and waited for — the search indexer's removal has finished
   * before this returns). Archiving an archived product is a no-op: no audit row,
   * no event, `changed: false`.
   *
   * 404 `PRODUCT_NOT_FOUND` for an unknown, soft-deleted or non-UUID id.
   */
  async archiveProduct(id: string): Promise<{ product: Product; changed: boolean }> {
    return this.#setArchived(id, true);
  }

  /**
   * Feature 163 (FR-019) — Restore one product: the `product.restore` Command clears
   * `archivedAt`, announces `product.updated.v1` `['archivedAt']`, and leaves the
   * status where it is (an `inactive` product stays off). No-op on a product that is
   * not archived.
   */
  async restoreProduct(id: string): Promise<{ product: Product; changed: boolean }> {
    return this.#setArchived(id, false);
  }

  async #setArchived(id: string, archive: boolean): Promise<{ product: Product; changed: boolean }> {
    // A non-UUID id would reach PostgreSQL as an invalid `uuid` literal.
    if (!uuidSchema.safeParse(id).success) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const outcome = { changed: false };
    // The Command declares `product.updated.v1`; the Command Bus dispatches it
    // when its own scope ends, after commit. `product.archived.v1` is emitted
    // after that, into the scope opened here, so it is dispatched second.
    return this.events.run(async () => {
      const product = await this.#runCommand(this.#archiveCommand(id, archive, outcome));
      if (outcome.changed && archive) this.#emitArchived(product.id);
      return { product, changed: outcome.changed };
    });
  }

  #archiveCommand(id: string, archive: boolean, outcome: { changed: boolean }): Command<Product> {
    return {
      action: archive ? 'product.archive' : 'product.restore',
      objectType: 'product',
      objectId: id,
      run: async ({ em }) => {
        // Checkpoint C code review (C-W1) — the row lock serialises a single and a bulk
        // Archive of one product: the second reads the first's `archivedAt` and is the
        // no-op, so the transition is audited and announced once.
        const product = await em.findOne(Product, { id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!product) {
          throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
        }
        const before = product.archivedAt ?? null;
        if ((before !== null) === archive) {
          outcome.changed = false;
          return { result: product, skipAudit: true };
        }
        product.archivedAt = archive ? new Date() : null;
        em.persist(product);
        await em.flush();
        outcome.changed = true;
        return {
          result: product,
          before: { archivedAt: before?.toISOString() ?? null },
          after: { archivedAt: product.archivedAt?.toISOString() ?? null },
        };
      },
      event: (product) =>
        outcome.changed
          ? {
              eventName: 'product.updated.v1',
              payload: {
                eventId: randomUUID(),
                occurredAt: new Date().toISOString(),
                productId: product.id,
                changedFields: ['archivedAt'],
              },
            }
          : undefined,
    };
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

  #deleteProductCommand(id: string): Command<{ id: string; formerUrlKeys: string[] }> {
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
          name: product.name,
          deletedAt: product.deletedAt ?? null,
        };
        // Feature 163 (FR-072) — a deleted product's old URL keys stop redirecting.
        const urlRedirects = (await em.find(ProductUrlRedirect, { productId: id })).map((row) => ({
          id: row.id,
          languageCode: row.languageCode ?? null,
          key: row.key,
        }));
        if (urlRedirects.length > 0) await em.nativeDelete(ProductUrlRedirect, { productId: id });
        product.deletedAt = new Date();
        await em.flush();
        return {
          result: { id: product.id, formerUrlKeys: urlRedirects.map((row) => row.key) },
          before: { ...stateBefore, urlRedirects },
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
          formerUrlKeys: result.formerUrlKeys,
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
      /**
       * Feature 163 (FR-113, R30.4) — which archived products are listed, on
       * `archived_at` and independently of the status. Default `exclude`.
       */
      archived?: ProductArchivedMode;
      status?: ProductStatus;
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
    counts: ProductListCounts;
  }> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 500);
    const archivedMode = options.archived ?? 'exclude';

    // Feature 163 (R30.4) — the status and the archived mode are two independent
    // filters: `status` reads the status column, `archived` reads `archived_at`.
    const where: Record<string, unknown> = { deletedAt: null };
    if (options.status) where['status'] = options.status;
    if (archivedMode === 'exclude') where['archivedAt'] = null;
    else if (archivedMode === 'only') where['archivedAt'] = { $ne: null };
    if (options.type) {
      where['type'] = options.type;
    }

    const categoryProductIds = options.categorySlug?.trim()
      ? await this.productIdsInCategoryTree(em, options.categorySlug.trim())
      : null;
    if (categoryProductIds && categoryProductIds.size === 0) {
      return { items: [], page, pageSize, total: 0, counts: await this.#productListCounts(em) };
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
        if (archivedMode === 'exclude') qb.whereNull('archived_at');
        else if (archivedMode === 'only') qb.whereNotNull('archived_at');
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

    return { items, page, pageSize, total, counts: await this.#productListCounts(em) };
  }

  /**
   * The admin list's tab badges, across the *full* product set whatever tab is
   * active, so they stay honest (feature 163, R30.4): `all`, `active` and
   * `inactive` over non-archived, non-deleted rows; `archived` over archived,
   * non-deleted rows of either status.
   *
   * `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
   * connection, so the badges would be counted from outside a transaction the
   * caller holds open while the page above answers from inside it — one screen,
   * two views of `products` (issue #207).
   */
  async #productListCounts(em: EntityManager): Promise<ProductListCounts> {
    const rows = (await em.execute(
      `select status, (archived_at is not null) as archived, count(*) as count
         from products where deleted_at is null
        group by status, (archived_at is not null)`,
    )) as Array<{ status: string; archived: boolean; count: string | number }>;
    const counts: ProductListCounts = { all: 0, active: 0, inactive: 0, archived: 0 };
    for (const row of rows) {
      const n = Number(row.count) || 0;
      if (row.archived) {
        counts.archived += n;
        continue;
      }
      counts.all += n;
      if (row.status === 'active') counts.active += n;
      else if (row.status === 'inactive') counts.inactive += n;
    }
    return counts;
  }

  /**
   * Feature 033 — return all product ids matching list filters (no pagination).
   * Reuses the same filter semantics as {@link listProducts}.
   */
  async resolveProductIds(
    options: {
      /** Feature 163 (R30.4) — as {@link listProducts}; the route's default is `include`. */
      archived?: ProductArchivedMode;
      status?: ProductStatus;
      type?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
      q?: string;
    } = {},
  ): Promise<{ productIds: string[]; total: number }> {
    const maxSelectionSize = Number(process.env['CATALOG_MAX_RESOLVE_IDS'] ?? 10_000);
    const em = this.emFactory();
    const trimmedQ = options.q?.trim();
    const knex = em.getKnex();
    const archivedMode = options.archived ?? 'exclude';

    const applyListFilters = (qb: ReturnType<typeof knex>): ReturnType<typeof knex> => {
      // Mirror listProducts: soft-deleted rows are never selectable; the status
      // and the archived mode are independent filters (feature 163, R30.4).
      qb.whereNull('deleted_at');
      if (options.status) {
        qb.where('status', options.status);
      }
      if (archivedMode === 'exclude') qb.whereNull('archived_at');
      else if (archivedMode === 'only') qb.whereNotNull('archived_at');
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
   * (`flag = isComparable`); `flag = isPriceRule` is the picker payload for
   * price-building rules in a Price List. Other flags are surfaced for symmetry.
   */
  async listAttributesByFlag(
    flag:
      | 'isSearchable'
      | 'isFilterable'
      | 'isComparable'
      | 'isVariantAxis'
      | 'isPromoRule'
      | 'isPriceRule'
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
   * Feature 172 (FR-007 – FR-009, research R-21) — what deleting the attribute
   * would meet, for the attributes screen's confirmation dialog. The same query
   * the delete Command's guard runs, so the dialog and the refusal agree.
   */
  async getAttributeUsage(idOrKey: string): Promise<AdminAttributeUsage> {
    const attr = await this.getAttributeByIdOrKey(idOrKey);
    return readAttributeUsage(this.emFactory(), {
      definitionId: attr.customFieldDefinitionId,
      extensionId: attr.id,
      key: attr.key,
    });
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

  /**
   * Every variant of a product, by SKU — the admin's view (feature 161): no
   * channel, status or audience filter, unlike the storefront's product read.
   * A deleted or unknown product is `404`.
   */
  async listVariants(parentProductId: string): Promise<ProductVariant[]> {
    const product = await this.getProductById(parentProductId);
    return this.emFactory().find(ProductVariant, { parentProductId: product.id }, { orderBy: { sku: 'asc' } });
  }

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
        stockLevel: v.stockLevel,
      };
      if (req.variantAttributeValues !== undefined) {
        v.variantAttributeValues = req.variantAttributeValues;
      }
      if (req.stockLevel !== undefined) {
        v.stockLevel = req.stockLevel;
      }
      return {
        result: v,
        before,
        after: { sku: v.sku, stockLevel: v.stockLevel },
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
    const views = await this.#requireAttributeRead().listAll();
    // Feature 172 (FR-014, research R-7) — a Page Builder content attribute's
    // key is refused **before** the `existingKeys` exemption below: whether it
    // is new to this save or resent as "already stored", its value is a
    // document authored on the product content screen, never an attribute
    // value. This is the one guard every product write crosses.
    assertNoContentAttributeValues(attributeValues, views);

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
    const keyByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v.key]));
    const allowed = new Set(
      rows
        .map((r) => keyByDefinitionId.get(r.custom_field_definition_id))
        .filter((k): k is string => k !== undefined),
    );

    const rejected = keys.filter(
      (k) =>
        !allowed.has(k) &&
        !existingKeys.has(k),
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
    const missing = missingRequiredAttributeKeys(
      rows
        .map((r) => viewByDefinitionId.get(r.custom_field_definition_id))
        .filter((v): v is CatalogAttributeView => v !== undefined),
      mergedAttributeValues,
    );
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

}

/**
 * Feature 155 (FR-001, threat F5, D5) — a pieces minimum is an integer in
 * 1…1 000 000 and only a `simple` or `configurable` product may carry one;
 * `null` (clear) and an absent key are always allowed. Refused
 * `422 VALIDATION_FAILED` with `details.field`, the answer an in-process caller
 * gets where no route schema stood in front of it.
 */
function assertOrderMinimumAllowed(type: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!isValidOrderMinimum(value)) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'The minimum order quantity must be a whole number from 1 to 1000000.',
      { field: 'minOrderQuantity' },
    );
  }
  if (!isOrderMinimumEligibleType(type)) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      `A minimum order quantity applies to simple or configurable products only; got "${type}".`,
      { field: 'minOrderQuantity' },
    );
  }
}
