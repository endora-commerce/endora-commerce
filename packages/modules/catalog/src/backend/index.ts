import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { ERROR_CODES, type ListingPriceOrderPort, type ListingPricePort } from '@endora-commerce/contracts';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type {
  AssetReadPort,
  AssetReferenceRegistryPort,
  AdminNotificationRecordPort,
  AdminUserReadPort,
  CatalogAttachmentPort,
  CatalogAttributeReadPort,
  CatalogAttributeSetPort,
  CatalogBulkImportPort,
  PromptActionBulkProgressRegistryPort,
  PromptActionToolRegistryPort,
  CatalogCategoryReadPort,
  CatalogCategoryWritePort,
  CatalogGalleryPort,
  CatalogBundlePort,
  CatalogGroupedPort,
  CatalogPackagingPort,
  CatalogProductFilterPort,
  CatalogProductLinkPort,
  CatalogProductReadPort,
  CatalogProductWritePort,
  CatalogProductValueOverrideUpsert,
  CatalogProductValueOverrideWritePort,
  CatalogPromoAttributePort,
  CatalogQuickSearchPort,
  InventoryProductThresholdWritePort,
  SearchQueryPort,
  LanguageReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { StorefrontRevalidator } from '@endora-commerce/platform/http';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { AttachmentType } from './entities/attachment-type.entity.js';
import { AttributeSetAttribute } from './entities/attribute-set-attribute.entity.js';
import { AttributeSet } from './entities/attribute-set.entity.js';
import { BulkOperation } from './entities/bulk-operation.entity.js';
import { BundleSlotOption } from './entities/bundle-slot-option.entity.js';
import { BundleSlot } from './entities/bundle-slot.entity.js';
import { Category } from './entities/category.entity.js';
import { GalleryItemLabel } from './entities/gallery-item-label.entity.js';
import { GalleryItem } from './entities/gallery-item.entity.js';
import { GroupedItem } from './entities/grouped-item.entity.js';
import { ProductAttachment } from './entities/product-attachment.entity.js';
import { ProductAttribute } from './entities/product-attribute.entity.js';
import { ProductEditorPreference } from './entities/product-editor-preference.entity.js';
import { ProductLink } from './entities/product-link.entity.js';
import { ProductPackagingUnit } from './entities/product-packaging-unit.entity.js';
import { ProductValueOverride } from './entities/product-value-override.entity.js';
import { ProductVariant } from './entities/product-variant.entity.js';
import { Product } from './entities/product.entity.js';
import { catalogModule, type CatalogModuleOptions } from './plugin.js';
// D-77 — the apply seam's type comes from this module's single naming of it in
// `commands/attribute-commands.ts`, never a second reach of its own.
import type { CustomFieldDefinitionApplyApi } from './commands/attribute-commands.js';
import { CatalogAdminService } from './services/catalog-admin.service.js';
import { CatalogBulkImportService } from './services/catalog-bulk-import.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import { AttributeSetService } from './services/attribute-set.service.js';
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { BundleService } from './services/bundle.service.js';
import { PackagingUnitService } from './services/packaging-unit.service.js';
import { CatalogAttributeReadService } from './services/catalog-attribute-read.service.js';
import { CatalogCategoryReadService } from './services/catalog-category-read.service.js';
import { CatalogProductFilterService } from './services/catalog-product-filter.service.js';
import { CatalogProductReadService } from './services/catalog-product-read.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogQuickSearchService } from './services/catalog-quick-search.service.js';
import { ProductOverridesService } from './services/product-overrides.service.js';
import {
  createCatalogCategoryWritePort,
  createCatalogProductWritePort,
  createCatalogPromoAttributePort,
} from './services/catalog-write-ports.js';
import type {
  CatalogEventBus,
  CatalogWarehouseThresholdCopy,
} from './services/catalog-admin.service.js';
import { registerCatalogAssetReferences } from './services/asset-references.js';
import { registerCatalogAuditReferences } from './services/audit-references.js';
import { presenceAwareBulkRecorder } from './services/bulk-operation.service.js';
import {
  catalogBulkProgressReader,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
  type CatalogPromptToolsDeps,
} from './prompt-tools.js';

/**
 * `catalog` — seven services each composition built **twice** (feature 072,
 * wave 4, T142; the last module in the sweep).
 *
 * `catalogAdmin`, `categoryAdmin`, `attributeSets`, `gallery`, `attachments`,
 * `productLinks` and `grouped` were written out as `new X(...)` in each root
 * purely to hand to `pim_ergonode`, while this module constructed its own set
 * inside its plugin. Two live instances of each, per composition, differing by
 * whichever constructor arguments a root happened to repeat — the T131 note
 * called it "issue #44's shape in a second module and at seven times the size",
 * and this is where it drains. They are ports now, so there is one of each and
 * the Ergonode importer writes through the same instance the admin API does.
 *
 * `catalogQueryPort` is the other half of #44. Each composition built a
 * `CatalogQueryService` for `promotions` with two constructor arguments left
 * `undefined`, and this module built its own; the note in `promotions/backend.ts`
 * predicted it would drain here. It does.
 *
 * **Two options only production passed.** `adminNotificationService` and
 * `mailer` were absent from the harness, so the bulk-operation completion
 * notice and its e-mail were exercised by nothing — the shape this wave has
 * removed a dozen times. Both are ports the module resolves now.
 *
 * `runBulkOperationWorker` stays root-supplied and stays a value (Principle X):
 * whether this process runs the BullMQ consumer is a deployment decision, read
 * at construction because it decides whether the consumer is built at all.
 * `reindexSearchIndexes` stays contributed for the reason `ksef` and
 * `product_feeds` keep theirs — production runs a real Meilisearch reindex and
 * the harness must not, so what a test composition substitutes is information
 * about the seam rather than boilerplate to normalise away.
 */

/** What `catalog` resolves from the container, and the names it owns. */
export interface CatalogCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditPort;
  readonly moduleQueueRedis: Redis | undefined;
  /**
   * The process connection, distinct from `moduleQueueRedis`: the assistant's
   * bulk tools delegate over the same queue in both compositions, which is a
   * property the harness asserts.
   */
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipPort;
  readonly customFieldValueService: NonNullable<CatalogModuleOptions['customFieldValues']>;
  /**
   * `custom_fields`' published definition read model — the definitions this
   * module composes its attribute read model out of, and the filterable set the
   * storefront query merges in.
   *
   * The name is `customFieldDefinitionReadPort` since D-98.2: the container
   * name a contract publishes, rather than the owner's own CRUD registration.
   */
  readonly customFieldDefinitionReadPort: NonNullable<
    CatalogModuleOptions['customFieldDefinitions']
  >;
  /**
   * The apply seam, and a **different question** from the read port above.
   *
   * The two used to be one name here: both roots passed the owner's
   * `CustomFieldDefinitionService` for `customFieldDefinitions` and for
   * `customFieldsPort` because one service satisfies both shapes, so all four
   * of this module's resolutions named `customFieldDefinitionService` — the two
   * answers under one key that the `catalog:customFieldDefinitionService` ledger
   * entry recorded. The read half names the published port now; this half
   * cannot, because every `apply*` method of `CustomFieldDefinitionApplyApi`
   * takes the caller's `EntityManager` (FR-034 keeps a MikroORM type out of
   * `@endora-commerce/contracts`) and `fk_product_attributes_custom_field_definition` is
   * what holds it co-transactional (D-77).
   *
   * T053(b) finished the split the ledger entry describes: the last read this
   * name answered — one definition by id — is
   * `customFieldDefinitionReadPort.getById` now, so what is left here is the
   * six co-transactional writes and the post-commit invalidation that is a step
   * of their own protocol.
   */
  readonly customFieldDefinitionService: CustomFieldDefinitionApplyApi;
  readonly pricingService: NonNullable<CatalogModuleOptions['pricingService']>;
  readonly languageService: NonNullable<CatalogModuleOptions['languageService']>;
  /**
   * `admin_notifications`' gated port — wrapped below, never handed on raw.
   * The name is `adminNotificationRecordPort` since D-98.2: the container name
   * a contract publishes, rather than the owner's class registration.
   */
  readonly adminNotificationRecordPort: AdminNotificationRecordPort;
  readonly emailMailer: NonNullable<CatalogModuleOptions['mailer']>;
  readonly requireApiKey: NonNullable<CatalogModuleOptions['requireApiKey']>;
  readonly requireBoundApiKey: NonNullable<CatalogModuleOptions['requireBoundApiKey']>;
  /** Root-supplied (Principle X): the harness runs no bulk-operation consumer. */
  readonly catalogRunBulkOperationWorker: boolean;
  /** Root-shaped: how this deployment names the acting admin on an audit record. */
  readonly catalogAdminAuditContext: NonNullable<CatalogModuleOptions['resolveAdminAuditContext']>;
  /**
   * Contributed: how a stock availability band is resolved for the external
   * catalog namespace, and the storefront image placeholder. Each reaches a
   * module `catalog` must not read through directly.
   */
  readonly catalogExternalAvailability: NonNullable<
    CatalogModuleOptions['resolveExternalAvailability']
  >;
  readonly catalogImagePlaceholderUrl: NonNullable<
    CatalogModuleOptions['resolveProductImagePlaceholderUrl']
  >;
  /** Contributed: production runs a real Meilisearch reindex; the harness must not. */
  readonly catalogSearchReindex: NonNullable<CatalogModuleOptions['reindexSearchIndexes']>;
  /**
   * Owned by `assets_library`: the registry that refuses to delete an asset a
   * product gallery, attachment, virtual download or category image points at.
   *
   * Typed as the published contract since feature 075 — an ungated
   * `ctx.di.register` on the owner's side (D-39), so this stays a plain cradle
   * read rather than a `lazyPort`, and the shape crossing the boundary is a
   * `@endora-commerce/contracts` interface rather than `assets_library`'s class.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistryPort;
  /**
   * Owned by `prompt_actions`: the assistant's tool catalogue. An ungated
   * registration this module pushes into once, from a boot hook — declared as a
   * `contributes-to` edge rather than a dependency (D-44).
   */
  readonly promptActionToolRegistry: PromptActionToolRegistryPort;
  /**
   * Owned by `prompt_actions`: where a delegated bulk request reads its live
   * progress from. The same shape as the tool catalogue above, and new for the
   * same reason (D-72 point 4) — until it existed, `promptActionsBulkProgressResolver`
   * was a single name `prompt_actions` defaulted and a composition root
   * overwrote with this module's resolver, which is the one thing a module may
   * not do. A table it can push into, so the contribution moves here with the
   * other five.
   */
  readonly promptActionBulkProgressRegistry: PromptActionBulkProgressRegistryPort;
  readonly catalogAttributeReadPort: CatalogAttributeReadService;
  readonly catalogQueryPort: CatalogQueryService;
  readonly catalogAdminService: CatalogAdminService;
  readonly categoryAdminService: CategoryAdminService;
  readonly attributeSetService: AttributeSetService;
  readonly galleryService: GalleryService;
  readonly attachmentService: AttachmentService;
  readonly productLinkService: ProductLinkService;
  readonly groupedService: GroupedService;
  readonly bundleService: BundleService;
  readonly packagingUnitService: PackagingUnitService;
  readonly catalogCategoryRevalidator: StorefrontRevalidator;
  readonly catalog: ReturnType<typeof catalogModule>;
}

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): CatalogCradle => ctx.cradle<CatalogCradle>();

  /**
   * The two API-key gates, with the presence probe D-44 requires of a
   * `degrades-without` edge.
   *
   * The manifest withdraws the flip-time refusal on these, so `api_keys` may be
   * absent while these routes are mounted — route *registration* runs whatever
   * any module's effective state is. `requireApiKey` is a gated port, and a
   * closed gate **throws** rather than resolving to `undefined`, so optional
   * chaining defends against nothing here: the probe has to come first.
   *
   * Per request rather than per registration, because the operator flips
   * between the two. The absent answer is the same 401 an unauthenticated
   * caller gets — the door is shut, not broken.
   *
   * Written out twice rather than parameterised by the port name: a computed
   * cradle read is a name `check-port-dependencies.ts` cannot verify, and it
   * refuses the shape rather than guessing at it.
   */
  const apiKeysPresent = (): void => {
    if (!effectiveState.isPresent('api_keys')) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'API key required.');
    }
  };

  const requireApiKeyGate =
    (scope: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      apiKeysPresent();
      return cradle().requireApiKey(scope)(request, reply);
    };

  const requireBoundApiKeyGate =
    (scope: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      apiKeysPresent();
      return cradle().requireBoundApiKey(scope)(request, reply);
    };

  /**
   * Issue #185 — the per-warehouse threshold copy product duplication makes.
   *
   * `duplicateProduct` used to run an `insert … select` into
   * `product_warehouse_low_stock_thresholds` on its own `EntityManager`. The
   * table is `inventory`'s, created by `inventory`'s migration, and the
   * statement named no import specifier, asked no gate and left no audit row on
   * that module's side — so the copy went on happening with `inventory`
   * switched off.
   *
   * The same D-44 shape as the two API-key gates above, and for the same
   * reason: this module declares `inventoryProductThresholdWritePort`
   * `degrades-without`, so a closed gate must never be *met*. Presence is
   * decided here, in front of the resolution, and the absent answer travels in
   * the return type rather than through a `catch` that would read a genuine
   * inventory failure as "this deployment has no warehouses".
   */
  const inventoryThresholds = lazyPort<InventoryProductThresholdWritePort>(
    ctx,
    'inventoryProductThresholdWritePort',
  );
  const copyWarehouseThresholds: CatalogWarehouseThresholdCopy = async (input) => {
    if (!effectiveState.isPresent('inventory')) return 'not-present';
    return inventoryThresholds.copyProductWarehouseThresholds(input);
  };

  ctx.di.register({
    /**
     * Feature 068 — the storefront serves the category tree from a fetch cache
     * tagged `catalog:categories`, flushed on every category write so an
     * activation toggle shows immediately. A no-op unless STOREFRONT_BASE_URL
     * and REVALIDATE_SECRET are configured.
     *
     * Registered here rather than built in the plugin body because the
     * subscription that drives it belongs in this file (issue #107); the plugin
     * still hands it `app.log` when the Fastify instance exists.
     */
    catalogCategoryRevalidator: ctx
      .asFunction(
        () =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }),
      )
      .singleton(),

    catalog: ctx
      .asFunction(
        ({
          emFactory,
          eventBus,
          commandBus,
          auditLogService,
          moduleQueueRedis,
          catalogRunBulkOperationWorker,
        }: CatalogCradle) =>
          catalogModule({
            emFactory,
            eventBus,
            commandBus,
            auditLogService,
            ...(moduleQueueRedis === undefined ? {} : { redis: moduleQueueRedis }),
            runBulkOperationWorker: catalogRunBulkOperationWorker,
            // The lifecycle gate, threaded in rather than imported. The
            // consumer is built inside the attach function — it needs `app.log`
            // and an `onClose` hook — so `plugin.ts` has no `ModuleContext`
            // where the worker exists; it called
            // `defineModuleWorker('catalog', …)` for itself until T051, which
            // `contracts/host-package.md` §1.4c classifies **A**. Same gate,
            // through the seam a composed module is meant to use.
            registerWorker: (worker, workerOptions) => {
              ctx.worker(worker, workerOptions);
            },
            customFieldValues: lazyPort<CatalogCradle['customFieldValueService']>(
              ctx,
              'customFieldValueService',
            ),
            // D-98.2 / issue #196 — the definition *read*, under the name a
            // contract publishes. `customFieldDefinitionService` is the owner's
            // own CRUD registration and answers a different question; it is
            // still the apply seam below, which no contract can publish.
            customFieldDefinitions: lazyPort<CatalogCradle['customFieldDefinitionReadPort']>(
              ctx,
              'customFieldDefinitionReadPort',
            ),
            // The apply seam (D-77): every `apply*` method takes the caller's
            // `EntityManager`, so it stays off `@endora-commerce/contracts` and keeps
            // naming the owner's own registration.
            customFieldsPort: lazyPort<CustomFieldDefinitionApplyApi>(
              ctx,
              'customFieldDefinitionService',
            ),
            attributeReadService: lazyPort<CatalogAttributeReadService>(
              ctx,
              'catalogAttributeReadPort',
            ),
            pricingService: lazyPort<CatalogCradle['pricingService']>(ctx, 'pricingService'),
            salesChannelMembership: lazyPort<SalesChannelMembershipPort>(
              ctx,
              'salesChannelMembershipPort',
            ),
            // Feature 075 — the *read* port rather than the whole admin service.
            // The two consumers in this module ask two questions between them,
            // `listActive` and `getDefault`, which is what `languageReadPort`
            // publishes.
            languageService: lazyPort<LanguageReadPort>(ctx, 'languageReadPort'),
            // Absent from the harness before T142, so the bulk-operation
            // completion notice and its e-mail ran in no test.
            //
            // D-60 — the bell's absence is decided here, in front of the gate,
            // and reaches the bulk-operation service as `not-present` in the
            // return type. A `catch` at the call site fused "the operator
            // switched notifications off" with "the write failed".
            adminNotificationService: presenceAwareBulkRecorder(
              // D-98.2 / issue #196 — `adminNotificationRecordPort` is the name
              // the contract publishes and the one that answers with a record;
              // `adminNotificationService` is the class registration, whose
              // `record` hands back the `AdminNotification` entity.
              lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort'),
            ),
            mailer: lazyPort<CatalogCradle['emailMailer']>(ctx, 'emailMailer'),
            // Issue #153 — `search`'s listing backend, resolved rather than
            // constructed. `plugin.ts` used to `new SearchQueryService(...)`
            // out of `search`'s class, so a composition held two Meilisearch
            // clients and the public product list reached the index through no
            // gate at all. Whether the listing uses it is still decided before
            // the call by `effectiveState.isPresent('search')`.
            searchQueryService: lazyPort<SearchQueryPort>(ctx, 'searchQueryPort'),
            // Feature 075 — `assets_library`'s read port. It fails closed, which
            // is right for both of its uses: an attach that cannot verify the
            // asset would store a dangling id, and a listing that cannot read
            // the asset row has no image URL to render. The module declares
            // `assets_library` in `dependencies`, so an operator cannot switch
            // it off underneath this.
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            // Feature 075 — the external namespace's calling organisation, and
            // the bulk-operation requester's e-mail address. Both were reads of
            // another module's entity against another module's table.
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            requireAdmin: (permission) => async (req, reply) =>
              cradle().requireAdmin(permission)(req, reply),
            requireApiKey: requireApiKeyGate,
            requireBoundApiKey: requireBoundApiKeyGate,
            resolveAdminAuditContext: (req: FastifyRequest) =>
              cradle().catalogAdminAuditContext(req),
            resolveExternalAvailability: (productIds, salesChannelId) =>
              cradle().catalogExternalAvailability(productIds, salesChannelId),
            resolveProductImagePlaceholderUrl: (salesChannelCode) =>
              cradle().catalogImagePlaceholderUrl(salesChannelCode),
            reindexSearchIndexes: () => cradle().catalogSearchReindex(),
            categoryRevalidator: cradle().catalogCategoryRevalidator,
            copyWarehouseThresholds,
          }),
      )
      .singleton(),
  });

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `catalog` is the heaviest provider in the tree: 107 inbound import sites
  // across fourteen modules, sixty of them on the `Product` and `Category`
  // entity classes. The nine ports below this block hand out *services*, which
  // is what the sweep's consumers type themselves against; these five are what
  // they rewire to, and none of them lets an entity across the boundary.
  //
  // The two read ports replace the sixty entity reads. The three adapters
  // narrow three large admin services to the methods `pim_ergonode` and
  // `promotions` measurably call — ten of `CatalogAdminService`'s hundred, two
  // of `CatalogQueryService`'s.
  //
  // `product_feeds`' predicate-driven product scan was deliberately unmet here
  // and escalated to the `product_feeds` cut, which ruled it: the module keeps
  // its selection DSL and compiles it to `CatalogProductFilter` — a grammar
  // narrower than MikroORM, published in `@endora-commerce/contracts` — and this module
  // translates and runs it, with the eligibility floor and the keyset cursor
  // inside `catalogProductFilterPort` rather than in the caller's conjunction.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<CatalogProductReadPort>(
    'catalogProductReadPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogProductReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<CatalogCategoryReadPort>(
    'catalogCategoryReadPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogCategoryReadService(emFactory))
      .singleton(),
  );

  /**
   * The selection scan `product_feeds` walks a channel with. Separate from
   * `catalogProductReadPort` because it answers a different question: that port
   * resolves rows a caller can already name, this one *finds* them — and it is
   * the only place the sellable floor and the keyset cursor are applied, so
   * neither can be composed away by a caller.
   */
  ctx.di.providePort<CatalogProductFilterPort>(
    'catalogProductFilterPort',
    ctx
      .asFunction(({ emFactory }: CatalogCradle) => new CatalogProductFilterService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<CatalogProductWritePort>(
    'catalogProductWritePort',
    ctx
      .asFunction(() =>
        createCatalogProductWritePort(() => ctx.cradle<CatalogCradle>().catalogAdminService),
      )
      .singleton(),
  );

  /**
   * Feature 089 — channel/locale-scoped product value writes for PIM importers.
   * Narrows `ProductOverridesService.applyBulk` so a foreign module never holds
   * the class (and never reaches `product_value_overrides` by SQL).
   */
  ctx.di.providePort<CatalogProductValueOverrideWritePort>(
    'catalogProductValueOverrideWritePort',
    ctx
      .asFunction(({ emFactory, commandBus }: CatalogCradle) => {
        const service = new ProductOverridesService(
          emFactory,
          lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
          commandBus,
          lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
        );
        return {
          async applyBulk(
            productId: string,
            input: { upserts: readonly CatalogProductValueOverrideUpsert[] },
          ) {
            await service.applyBulk(productId, { upserts: [...input.upserts], deletes: [] });
          },
        };
      })
      .singleton(),
  );

  ctx.di.providePort<CatalogCategoryWritePort>(
    'catalogCategoryWritePort',
    ctx
      .asFunction(() =>
        createCatalogCategoryWritePort(() => ctx.cradle<CatalogCradle>().categoryAdminService),
      )
      .singleton(),
  );

  /**
   * D-74 — the bulk import surface. `import_export` parses the spreadsheet;
   * this module owns the validation, the within-run slug index, the transaction
   * and the audit row, because every row a catalogue import writes lands in this
   * module's tables and in nobody else's.
   */
  ctx.di.providePort<CatalogBulkImportPort>(
    'catalogBulkImportPort',
    ctx
      .asFunction(
        ({ commandBus }: CatalogCradle) =>
          new CatalogBulkImportService(
            commandBus,
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
          ),
      )
      .singleton(),
  );

  /**
   * Issue #174 — the buyer's type-ahead, which `quick_order` was answering
   * with its own knex `select` against `products`.
   *
   * There was no import specifier, so `check:module-boundary` read clean over
   * it and no ledger shard could key it; and the query filtered
   * `status = 'active'` and nothing else, so a signed-in buyer saw every active
   * product on the platform whatever channel they were shopping. The predicate
   * is a catalogue question in every part — which rows are active, which are on
   * the channel, and which attribute values are searchable — so it is published
   * from here, scoped by `sales_channel_products` like every other
   * customer-facing read in this module.
   */
  ctx.di.providePort<CatalogQuickSearchPort>(
    'catalogQuickSearchPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogQuickSearchService(
            emFactory,
            lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogPromoAttributePort>(
    'catalogPromoAttributePort',
    ctx
      .asFunction(() =>
        createCatalogPromoAttributePort(() => ctx.cradle<CatalogCradle>().catalogQueryPort),
      )
      .singleton(),
  );

  // The nine ports. Seven of them were a second instance each root built for
  // `pim_ergonode`; the last two are the `CatalogQueryService` and attribute
  // read model that issue #44 recorded.
  //
  // Six of them gain a Phase-P contract type as their `providePort` parameter,
  // which is the compile-time proof that the class still satisfies what was
  // published. All six already returned contract DTOs, so none needed an
  // adapter — the two that returned entities did, and are above.
  ctx.di.providePort<CatalogAttributeReadPort>(
    'catalogAttributeReadPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogAttributeReadService(
            emFactory,
            // The definition read, under the published name (D-98.2).
            lazyPort<CatalogCradle['customFieldDefinitionReadPort']>(
              ctx,
              'customFieldDefinitionReadPort',
            ),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'catalogQueryPort',
    ctx
      .asFunction(
        ({ emFactory }: CatalogCradle) =>
          new CatalogQueryService(
            emFactory,
            undefined,
            undefined,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
            lazyPort<ListingPricePort>(ctx, 'pricingService'),
            lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            // Feature 086 — the ordering slice, off the same container and the
            // same declared edge. Two `lazyPort` calls rather than one widened
            // type, because a captured gate keeps answering after its owner is
            // switched off and both of these are handed to a singleton.
            lazyPort<ListingPriceOrderPort>(ctx, 'pricingService'),
            ctx.log,
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'catalogAdminService',
    ctx
      .asFunction(
        ({ emFactory, eventBus, auditLogService, commandBus }: CatalogCradle) =>
          new CatalogAdminService(
            emFactory,
            eventBus as unknown as CatalogEventBus,
            auditLogService,
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            commandBus,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
            // The apply seam, not the definition source. Both roots once passed
            // the same service for this and for the definition source, which is
            // why one name answered both questions; the read half names
            // `customFieldDefinitionReadPort` now and this half stays here,
            // unpublished by D-77 because every `apply*` method takes the
            // caller's `EntityManager`.
            //
            // The type argument names the **owner's** interface rather than an
            // indexed access into this module's own cradle: `lazyPort<T>` is an
            // unchecked cast either way, and a cradle lookup reaches the owner's
            // declaration by a route nothing states (!951's consumer-side
            // finding, in the same shape).
            lazyPort<CustomFieldDefinitionApplyApi>(ctx, 'customFieldDefinitionService'),
            copyWarehouseThresholds,
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'categoryAdminService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new CategoryAdminService(
            emFactory,
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            commandBus,
            lazyPort<CatalogCradle['customFieldValueService']>(ctx, 'customFieldValueService'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogAttributeSetPort>(
    'attributeSetService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new AttributeSetService(
            emFactory,
            commandBus,
            lazyPort<CatalogAttributeReadService>(ctx, 'catalogAttributeReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogGalleryPort>(
    'galleryService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new GalleryService(
            emFactory,
            commandBus,
            lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogAttachmentPort>(
    'attachmentService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new AttachmentService(
            emFactory,
            commandBus,
            lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogProductLinkPort>(
    'productLinkService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new ProductLinkService(
            emFactory,
            commandBus,
            lazyPort<ListingPricePort>(ctx, 'pricingService'),
            lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogGroupedPort>(
    'groupedService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new GroupedService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogBundlePort>(
    'bundleService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) => new BundleService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CatalogPackagingPort>(
    'packagingUnitService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CatalogCradle) =>
          new PackagingUnitService(emFactory, commandBus),
      )
      .singleton(),
  );

  /**
   * FR-030 — the four edges that block deleting an asset this module points at
   * (T143a): a gallery item, a product attachment, a virtual download and a
   * category's main image.
   *
   * Both roots pushed these descriptors into `assets_library`' registry, so the
   * "in use by" answer an operator got was assembled from whichever modules the
   * *root* had been taught about — and `catalog` being switched off did not
   * remove its four edges, because a root's registration passes through no
   * lifecycle seam.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read*, once per
   * delete, by the module that owns it. Boot hooks run after every module has
   * registered and before any request is served, so the edges are in place from
   * the first delete on.
   */
  ctx.onBoot(() => {
    const { assetReferenceRegistry, emFactory } = cradle();
    registerCatalogAssetReferences(assetReferenceRegistry, emFactory);
  });

  /**
   * The assistant tools this module contributes, and the bulk-progress reader
   * that goes with them (D-44; D-72 point 4 for the second half).
   *
   * Both roots built these from `catalog`'s own services and pushed them into
   * `prompt_actions`' registry, because pushing from here would have made
   * `prompt_actions` a declared dependency — and that declaration is what would
   * have made an optional assistant undeactivatable for as long as `catalog` is
   * present. `nonBindingDependencies` is the declaration without that claim, so
   * the contribution moves to the module whose services it is built from.
   *
   * The progress reader was the one of the five D-44 could not move, and not
   * for a presence reason: `promptActionsBulkProgressResolver` was a single
   * name `prompt_actions` defaulted, and a module may not write a name another
   * module owns. Now that the host keeps a table instead, it pushes from here
   * like everything else, and neither composition root names
   * `catalog/prompt-tools.js`.
   *
   * A push, not a pull: nothing is read back out of either registry here. Both
   * are plain `ctx.di.register`, so the resolution cannot ask a gate, and both
   * drop an entry whose recorded owner is not effectively present — so a
   * switched-off `catalog` contributes tools nobody can see and progress
   * nobody folds in, and a switched-off `prompt_actions` holds two tables
   * nobody walks.
   */
  ctx.onBoot(() => {
    // `redis`, not `moduleQueueRedis`: this is the connection both roots handed
    // these tools, and the harness deliberately registers the first while
    // withholding the second. Switching to the queue-shaped name here would
    // quietly stop the > 50-selection delegation in every test that exercises
    // it, which is a behaviour change this move has no business making.
    const deps: CatalogPromptToolsDeps = {
      emFactory: cradle().emFactory,
      events: cradle().eventBus,
      auditLogService: cradle().auditLogService,
      salesChannelMembership: cradle().salesChannelMembershipPort,
      redis: cradle().redis,
    };
    const registry = cradle().promptActionToolRegistry;
    for (const tool of [
      ...catalogPromptResolverTools(deps),
      ...catalogPromptMutationTools(deps),
    ]) {
      registry.register(tool);
    }
    cradle().promptActionBulkProgressRegistry.register('catalog', catalogBulkProgressReader(deps));
  });

  /**
   * Feature 068's cache flush (issue #107).
   *
   * It was a bare `eventBus.on` in the plugin body, so a switched-off `catalog`
   * still posted revalidation requests at the storefront on every category
   * write. `ctx.subscribe` stops it with the module — and the storefront's own
   * category surface is gone at that point anyway.
   */
  ctx.subscribe('category.updated.v1', () => {
    void cradle().catalogCategoryRevalidator.revalidate(['catalog:categories']);
  });

  ctx.routes(async (app) => {
    await cradle().catalog(app);
  });

  /**
   * What an audit row about a product is called, and where the admin app shows it
   * (feature 075, D-87 drain).
   *
   * `audit_logs` used to answer both by hand — one SQL statement naming this
   * module's table, and this module's admin route spelled into its own switch.
   * A read port would have been the wrong repair: `audit_logs` is a
   * cross-cutting reader, and five ports into it would be five edges pointing
   * from the record towards the things it records. One of the five contributors
   * (`inventory`) is switchable, and `audit_logs` is `nonDeactivatable`, so that
   * edge would also have taken the operator's switch away. A push costs nothing
   * and reads the same for all five.
   *
   * A **contribution** hook: it pushes an inert resolver into
   * `auditReferenceRegistry`, an ungated registry, and carries no presence probe
   * (D-67/D-68). The registry's own enumeration policy is what drops this entry
   * while the module is absent — probing here would make the drop survive a
   * reactivation until the next restart.
   */
  ctx.onBoot(() => {
    registerCatalogAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      cradle().emFactory,
    );
  });
}

/**
 * Every entity class this module owns, as one array — the `./backend` subpath's
 * contribution to the ORM (D-168).
 *
 * A module package publishes this array and **no entity class by name**, type-only
 * exports included: `import { Product } from '@endora-commerce/mod-catalog/backend'`
 * has to fail in a stranger's compiler, where none of this repository's checks run.
 * A host program that has to construct one picks it out by name with `entityNamed`
 * (`backend/src/packages/package-entity-lookup.ts`), which resolves against this
 * array — the same one the ORM registered, so there is exactly one copy of each
 * class in the process (D-160.6, D-160.6.1).
 *
 * The order is the one `db/entities-registry.generated.ts` declared before this
 * module became a package, so the registered set is the same list in the same
 * sequence.
 */
export const entities = [
  AttachmentType,
  AttributeSetAttribute,
  AttributeSet,
  BulkOperation,
  BundleSlotOption,
  BundleSlot,
  Category,
  GalleryItemLabel,
  GalleryItem,
  GroupedItem,
  ProductAttachment,
  ProductAttribute,
  ProductEditorPreference,
  ProductLink,
  ProductPackagingUnit,
  ProductValueOverride,
  ProductVariant,
  Product,
];

/**
 * The catalogue read surface a host program needs, published **by name**.
 *
 * `src/seeds/dev-catalog-seed.ts` hands a `CatalogProductReadService` to
 * `price_lists`' `DefaultPriceListMigrator`, and `src/seeds/attribute-fixtures.ts`
 * maps a legacy attribute value type onto the unified custom-field model. Both are
 * host programs in the **compiled** build (`node dist/seeds/dev-catalog-seed.js`,
 * documented in `deploy/README.md`), so neither may name this package's source: a
 * filesystem path would evaluate the file a second time, and `backend/tsconfig.build.json`
 * sets `rootDir: ./src`, which is TS6059 for a `.ts` outside it even under `import type`.
 *
 * D-168 bars an **entity class** from leaving by this door; a service and a pure
 * mapping function are not entities, and `inventory`'s `WarehouseChannelReconciler` /
 * `price_lists`' `DefaultPriceListMigrator` are the precedent for exactly this shape.
 *
 * `CatalogQueryService` is published as a **type** for `src/composition.ts`, which
 * declares the cradle slot `promotions`, `quick_order` and `search` each resolve their
 * own instance from. It is the same rewrite the root has already done for nine other
 * packaged modules; a type import evaluates nothing, so it raises no second copy.
 */
export { CatalogProductReadService } from './services/catalog-product-read.service.js';
export {
  legacyToCfType,
  type LegacyAttributeValueType,
} from './services/attribute-type-mapping.js';
export type { CatalogQueryService } from './services/catalog-query.service.js';
