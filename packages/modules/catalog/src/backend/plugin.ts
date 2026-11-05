import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Worker } from 'bullmq';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  BULK_OPERATION_TYPES,
  type AssetReadPort,
  type SearchQueryPort,
  type AdminUserReadPort,
  type CatalogProductAvailabilityPort,
  type EmailMailerPort,
  type LanguageReadPort,
  type ListingPriceOrderPort,
  type ListingPricePort,
  type ListingPriceDetailPort,
  type OrgLinePricePort,
  type LinePricesPort,
  type CustomFieldDefinitionReadPort,
  type CustomFieldValuePort,
  type OrganizationDetailsPort,
  type SeoProductMetaWritePort,
} from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import type { StorefrontRevalidator } from '@endora-commerce/platform/http';
import type { AdminPermissionChecker, PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  createBulkOperationQueue,
  createBulkOperationWorker,
  BULK_OPERATION_JOB_NAME,
} from './services/bulk-operation-queue.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort, SettingsReadPort } from '@endora-commerce/platform/kernel';
import { CatalogQueryService, type CatalogCursorSeal } from './services/catalog-query.service.js';
import {
  CatalogAdminService,
  type CatalogWarehouseThresholdCopy,
  type CatalogSeoProductMetaCopy,
  type CatalogEventBus,
} from './services/catalog-admin.service.js';
import { CatalogAttributeReadService } from './services/catalog-attribute-read.service.js';
// D-77 — the apply seam's type is named once in this module, by
// `commands/attribute-commands.ts`; every other file takes that re-export, so
// the boundary ledger carries one entry rather than one per consumer.
import type { CustomFieldDefinitionApplyApi } from './commands/attribute-commands.js';
import { CatalogBulkUpdateService } from './services/catalog-bulk-update.service.js';
import {
  BulkOperationService,
  type BulkNotificationRecorder,
  type SearchReindexRunner,
} from './services/bulk-operation.service.js';
import {
  CategoryAdminService,
  type CategoryEventBus,
} from './services/category-admin.service.js';
import { AttributeSetService } from './services/attribute-set.service.js';
import { ProductContentService } from './services/product-content.service.js';
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { PackagingUnitService } from './services/packaging-unit.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { BundleService } from './services/bundle.service.js';
import { ProductEditorPreferencesService } from './services/product-editor-preferences.service.js';
import { ProductListViewService } from './services/product-list-view-service.js';
import { ProductScopesService } from './services/product-scopes.service.js';
import { UrlKeyService } from './services/url-key.service.js';
import { ScopeOverviewService, type ListSeoProductScopes } from './services/scope-overview.service.js';
import { composeCompletenessGate } from './services/scope-completeness.js';
import { AttributeScopePreviewService } from './services/attribute-scope-preview.js';
import { ScopedValuesService } from './services/scoped-values.service.js';
import { ProductValueResolverService } from './services/product-value-resolver.service.js';
import { readContext as readCatalogContext, registerCatalogPublicRoutes } from './routes.public.js';
import { registerCatalogUrlKeyPublicRoutes } from './routes.public.url-keys.js';
import { UrlKeyResolutionService } from './services/url-key-resolution.service.js';
import type { ResolveSeoProductMeta } from './services/catalog-query.service.js';
import type { ReadSeoProductScoped } from './services/scoped-values-read.service.js';
import { registerCatalogAdminRoutes } from './routes.admin.js';
import { registerCatalogApiKeyRoutes } from './routes.api-key.js';
import { registerCatalogExternalRoutes } from './routes.external.js';
import {
  CatalogOrgPriceDecorator,
  type ResolveAvailabilityPort,
} from './services/catalog-org-price-decorator.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Composition root for the catalog module. Wires the ORM's per-request EM into
 * the query/admin services and registers the public, admin, and api-key route
 * surfaces.
 */

export type RequireApiKeyFactory = (
  scope: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CatalogModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  /**
   * Issue #497 — what the storefront listing seals a price walk's cursors
   * with. Optional for fixtures that never sort or filter by price; a price
   * walk without it fails loudly.
   */
  cursorSeal?: CatalogCursorSeal;
  /**
   * Feature 068 — flushes the storefront's `catalog:categories` fetch-cache tag.
   * Owned by `backend.ts`, which also owns the `category.updated.v1`
   * subscription that drives it; passed here only so it can pick up `app.log`
   * once the Fastify instance exists.
   */
  categoryRevalidator?: StorefrontRevalidator;
  requireAdmin?: RequireAdminFactory;
  /** Audit-log writer; if provided, mutations land an AuditLogEntry. */
  auditLogService?: AuditPort;
  /** Resolver for who's acting — used for audit attribution. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
  /**
   * API-key gate factory injected by the integrations module composition root.
   * When provided, the catalog by-sku upsert route uses real api-key auth
   * (T220 out-of-scope → 403). When undefined, the route falls back to a
   * pass-through gate.
   */
  requireApiKey?: RequireApiKeyFactory;
  /**
   * Feature 062 — bound-key gate injected by the integrations module. When
   * BOTH this and `pricingService` are provided (alongside `requireApiKey`),
   * the external catalog namespace (`/api/v1/external/catalog/*`) is
   * registered. When omitted (legacy fixtures), the namespace is absent.
   */
  requireBoundApiKey?: RequireApiKeyFactory;
  /**
   * Feature 062 — the price-lists pricing engine (the same resolver cart
   * pricing uses). Consumed only by the external catalog namespace's
   * decoration layer — SC-001 parity by construction.
   */
  pricingService?: OrgLinePricePort &
    LinePricesPort &
    ListingPricePort &
    ListingPriceDetailPort &
    ListingPriceOrderPort;
  /**
   * Feature 062 — inventory availability port for the external namespace's
   * `availability` indication. Optional: when omitted the field is omitted.
   */
  resolveExternalAvailability?: ResolveAvailabilityPort;
  /**
   * Feature 163 (R13) — `seo`'s product metadata per sales channel × language for
   * the product page; answers `null` while `seo` is not effectively present.
   * Optional: without it the page serves its derived metadata.
   */
  resolveSeoProductMeta?: ResolveSeoProductMeta;
  /**
   * Feature 172 (FR-051, research R-13) — whether the Page Builder's owner is
   * effectively present; gates the product page's `contentAttributes`. Optional:
   * without it the page carries no content.
   */
  isPageBuilderPresent?: () => boolean;
  /**
   * Feature 163 (T118c) — `seo`'s scopes of a product for the scope overview; answers
   * `[]` while `seo` is not effectively present. Optional: without it the overview lists
   * no SEO field.
   */
  listSeoProductScopes?: ListSeoProductScopes;
  /**
   * Feature 174 (T123) — `seo`'s view of a product's metadata at one scope for the editor's
   * scoped read; answers `null` while `seo` is not effectively present.
   */
  readSeoProductScoped?: ReadSeoProductScoped;
  /**
   * Feature 174 (T123, FR-091) — `seo`'s write port for the save's SEO cells, resolved only when a
   * save changes SEO (a lazy port: with `seo` off resolving it answers `503 MODULE_DISABLED`).
   */
  seoProductMetaWrite?: () => Pick<SeoProductMetaWritePort<EntityManager>, 'readWithin' | 'applyWithin'>;
  /**
   * Feature 075 — `organizations`' read port. The external namespace's price
   * decoration resolves the calling organisation through it, where it used to
   * run `em.findOne(Organization, …)` against another module's table.
   *
   * The storefront listing, the PDP and the cross-sell strip resolve it too:
   * the caller's own price is the caller's organisation's, and the one field
   * the pricing engine needs beyond the id — the customer group a
   * group-targeted list is selected by — lives on that row.
   *
   * Feature 163 (owner decision U1) — the product scopes answer names the
   * organizations its audience rules name, best effort.
   */
  organizations?: OrganizationDetailsPort;
  /**
   * Feature 075 — `admin_users`' read port, for the one row the bulk-operation
   * completion notice reads: the requester's e-mail address.
   */
  adminUsers?: AdminUserReadPort;
  /**
   * Feature 163, checkpoint F (S-3) — `admin_roles`' `permissionService`: a queued
   * bulk operation re-checks, at worker start, that its requester may still write.
   */
  permissionChecker?: AdminPermissionChecker;
  /**
   * Feature 005 / T027 — when provided, every newly-created Product is
   * automatically bound to the system-default Sales Channel unless it
   * already had memberships set through some other path (FR-011).
   * Production composition.ts always provides this; tests omit it for
   * pre-feature-005 fixtures.
   */
  salesChannelMembership?: SalesChannelMembershipPort;
  /**
   * Feature 163 — this module's own `catalogProductAvailabilityPort` (the
   * registered instance), for the external bulk-price probe (W5 = A). The
   * external namespace is not mounted without it.
   */
  productAvailability?: Pick<CatalogProductAvailabilityPort, 'filterAvailable'>;
  /**
   * Issue #185 — `inventory`'s per-warehouse threshold copy, used by product
   * duplication. Contributed as a presence-decided closure rather than resolved
   * here, for the reason `resolveExternalAvailability` is: this module declares
   * `inventory` `degrades-without`, so absence is decided in front of the gate
   * and reaches the service in its return type.
   */
  copyWarehouseThresholds?: CatalogWarehouseThresholdCopy;
  /**
   * Feature 174 (FR-119) — `seo`'s product metadata copied by a duplicate, on the duplicate
   * Command's em. Presence-decided by the wiring, like the threshold copy above.
   */
  copySeoProductMeta?: CatalogSeoProductMetaCopy;
  /**
   * Feature 022 / 163 / 174 — the platform's languages: read by the value
   * resolver, the scope overview (the active languages of a product in no
   * channel) and the scoped-values read (each channel language's name).
   * Optional: when omitted the resolver and the scope overview are not
   * registered, and the scoped-values read names a language by its code.
   */
  languageService?: LanguageReadPort;
  /**
   * Feature 163 (FR-060) — the platform's settings read, for the completeness
   * gate's mode (`catalog.scope_completeness_gate`). Optional: when omitted no
   * operator write is gated.
   */
  settingsReadPort?: Pick<SettingsReadPort, 'get'>;
  /**
   * In-app (bell) notifications — used by the queued bulk-edit path to
   * tell the requester their background operation finished. Optional;
   * when omitted the notification is simply skipped.
   *
   * The **recorder** shape rather than `admin_notifications`' service: absence
   * is an answer this module reads off the return type (D-60), not an exception
   * it catches after the fact.
   */
  adminNotificationService?: BulkNotificationRecorder;
  /**
   * Email transport — used by the queued bulk-edit path to email the
   * requester on completion. Optional; when omitted email is skipped.
   */
  mailer?: EmailMailerPort;
  /**
   * Redis connection used to back the bulk-operation queue (Principle X).
   * When provided, `create()` enqueues each operation onto a durable BullMQ
   * queue instead of processing it in-process. When omitted (tests), enqueue
   * is a no-op and queued rows stay `pending` for direct-driven assertions.
   */
  redis?: Redis;
  /** Feature 054 — enables bulk-edit undo (capture revert state + audited undo). */
  commandBus?: CommandBus;
  /**
   * When `true` (and `redis` is provided), this process also runs the
   * bulk-operation **consumer** (a BullMQ worker). Co-locating the worker in
   * the API process is the default single-VPS posture; set `BACKEND_ROLE=api`
   * and run `pnpm --filter backend run worker` to split it into its own
   * independently scalable process without code changes.
   */
  runBulkOperationWorker?: boolean;
  /**
   * The lifecycle gate for a constructed BullMQ worker — `ctx.worker`, threaded
   * in by `backend.ts`.
   *
   * The consumer is built inside the attach function, because it needs
   * `app.log` and an `onClose` hook, so this file has no `ModuleContext` where
   * the worker exists. It called `defineModuleWorker('catalog', …)` directly
   * until T051, which `contracts/host-package.md` §1.4c classifies **A**:
   * publishing that wrapper would re-open by bare specifier the seam
   * `check:subscribe-seam` closed by relative path. Taking the seam as an
   * argument is the same gate reached the sanctioned way.
   */
  registerWorker: (worker: Worker, options?: { logger?: PlatformLogger }) => void;
  /**
   * The module's logger. The saved-view service writes its actor-≠-owner trail
   * through it (`specs/147-saved-views/` research R-18, S-11).
   */
  log?: PlatformLogger;
  /**
   * Runs a full Meilisearch reindex (the `search:reindex` CLI equivalent).
   * When provided, flipping an attribute's `searchable` flag enqueues a
   * `search_reindex` bulk operation that calls this. Wired from the
   * composition root so catalog stays decoupled from the search module.
   */
  reindexSearchIndexes?: SearchReindexRunner;
  /**
   * Resolves the `general.product_image_placeholder_url` setting (global or
   * per sales channel) for a channel code. Wired from composition so catalog
   * stays decoupled from the settings module. When provided, storefront
   * product summaries / details with no image fall back to the configured URL.
   */
  resolveProductImagePlaceholderUrl?: (
    salesChannelCode: string | undefined,
  ) => Promise<string | null>;
  /** Feature 055 — validates + reads Category custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 055 (US4) — custom-field definition source. When wired, Category
   * custom fields flagged `config.filterable` are merged into the storefront
   * filter set by `CatalogQueryService`. Catalog interprets the opaque config.
   *
   * Feature 061 — the same object (production wiring passes the
   * `CustomFieldDefinitionService`) also backs the composed attribute read
   * model, and since T053(b) the attribute write path's committed-state
   * definition read with it.
   */
  customFieldDefinitions?: CustomFieldDefinitionReadPort;
  /**
   * Feature 061 — the custom_fields apply seam used by the attribute Commands.
   * Production + test composition pass the `CustomFieldDefinitionService` here
   * (it implements the interface). The committed-state definition read that
   * used to travel with it is `customFieldDefinitions`' since T053(b).
   */
  customFieldsPort?: CustomFieldDefinitionApplyApi;
  /**
   * Feature 061 — pre-built composed attribute read service. When omitted but
   * `customFieldDefinitions` is present, the plugin constructs its own.
   */
  attributeReadService?: CatalogAttributeReadService;
  /**
   * Issue #153 — `search`'s storefront listing backend, resolved as a port.
   *
   * This module used to `new SearchQueryService(...)` here out of `search`'s
   * class, so a composition held two Meilisearch clients and two attribute-read
   * wirings, and no gate stood between the public product list and an index
   * whose maintenance subscribers had stopped with a switched-off `search`.
   * `backend.ts` resolves `searchQueryPort` instead.
   *
   * Whether the listing *uses* it is still decided before the call, by
   * `effectiveState.isPresent('search')` in `routes.public.ts` (MR !573) — a
   * degrade to Postgres by decision, not by exception.
   */
  searchQueryService?: SearchQueryPort;

  /**
   * Feature 075 — `assets_library`'s read port. Every service below that shows
   * or verifies an image takes it: the gallery and attachment writers check the
   * asset's `kind` before storing a reference to it, and the storefront reads
   * resolve the primary image URL through it. It replaces four
   * `em.findOne/find(Asset, …)` calls and six raw `join assets` clauses.
   */
  assets?: AssetReadPort;
}

export function catalogModule(options: CatalogModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const productLinkServiceForRead = new ProductLinkService(
      options.emFactory,
      options.commandBus,
      options.pricingService,
      options.assets,
      options.salesChannelMembership,
      options.organizations,
    );
    // Feature 061 — the composed attribute read model (definitions from the
    // custom_fields cache + catalog extension rows). Constructed once and
    // threaded into every attribute consumer in this module.
    const attributeReadService =
      options.attributeReadService ??
      (options.customFieldDefinitions
        ? new CatalogAttributeReadService(options.emFactory, options.customFieldDefinitions)
        : undefined);
    const queryService = new CatalogQueryService(
      options.emFactory,
      productLinkServiceForRead,
      options.customFieldDefinitions,
      attributeReadService,
      options.pricingService,
      options.assets,
      options.salesChannelMembership,
      options.organizations,
      // Feature 086 — the ordering slice of the same `pricingService`.
      options.pricingService,
      // No scan-budget log on this instance, as before.
      undefined,
      options.cursorSeal,
      // Feature 163 — the page's metadata through `seo`, presence-probed by the caller.
      options.resolveSeoProductMeta,
      // Feature 172 — the product page's content, presence-probed by the caller.
      options.isPageBuilderPresent,
    );
    // Feature 163 (FR-060, FR-061) — the completeness gate, composed into the
    // operator's admin services only (this file); the integration ports registered in
    // `index.ts` are built without it, so imports and connectors are never gated (A-6).
    const completenessGate = composeCompletenessGate(
      {
        membership: options.salesChannelMembership,
        attributeRead: attributeReadService,
        settings: options.settingsReadPort,
      },
      options.log ?? app.log,
    );
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
      options.auditLogService,
      options.salesChannelMembership,
      options.commandBus,
      attributeReadService,
      options.customFieldsPort,
      options.copyWarehouseThresholds,
      completenessGate,
      options.assets,
      options.copySeoProductMeta,
    );
    // Feature 163 — scoped values per channel and channel × language. Needs the
    // membership accessor for FR-014 and the C4 warning, like the overrides.
    // Owner decision U1 — `organizations` names the audience's organizations in the answer.
    const scopesService = options.salesChannelMembership
      ? new ProductScopesService(
          options.emFactory,
          options.salesChannelMembership,
          options.commandBus,
          options.organizations,
          completenessGate,
        )
      : undefined;
    const bulkUpdateService = new CatalogBulkUpdateService(
      options.emFactory,
      adminService,
      options.salesChannelMembership,
      options.auditLogService,
      // Feature 163 (FR-050) — bulk scoped status runs the operator's scope write.
      scopesService,
    );

    // Queued bulk-edit (Principle X): large selections persist as `pending`
    // operations on a durable BullMQ queue. The producer (`create()`) only
    // enqueues; a separable BullMQ worker (below / or its own process) is the
    // consumer. When no Redis is wired (tests) enqueue is a no-op and rows
    // stay `pending` for direct-driven assertions.
    const bulkOperationQueue = options.redis
      ? createBulkOperationQueue(options.redis)
      : undefined;
    const bulkOperationService = new BulkOperationService(options.emFactory, bulkUpdateService, {
      // Feature 163 (R30.3) — an undo announces what it reverted.
      events: options.eventBus as CatalogEventBus,
      ...(options.adminNotificationService
        ? { notificationService: options.adminNotificationService }
        : {}),
      ...(options.mailer ? { mailer: options.mailer } : {}),
      ...(options.adminUsers ? { adminUsers: options.adminUsers } : {}),
      ...(options.permissionChecker ? { permissionChecker: options.permissionChecker } : {}),
      ...(options.reindexSearchIndexes
        ? { reindexRunner: options.reindexSearchIndexes }
        : {}),
      ...(bulkOperationQueue
        ? {
            onEnqueued: async (operationId: string): Promise<void> => {
              await bulkOperationQueue.add(BULK_OPERATION_JOB_NAME, { operationId });
            },
          }
        : {}),
    },
      options.commandBus,
    );

    // When a reindex runner is wired, flipping an attribute's `searchable`
    // flag enqueues a `search_reindex` bulk operation (visible on the
    // "Akcje masowe" page, with the same bell + email notifications).
    if (options.reindexSearchIndexes) {
      const queue = bulkOperationService;
      adminService.setSearchReindexEnqueuer(async ({ actorAdminUserId }) => {
        // Exempt from the known-requester rule by design (S-L3): a reindex writes no
        // product, and the flip that enqueues it may have no admin behind it.
        await queue.create({
          type: BULK_OPERATION_TYPES.SEARCH_REINDEX,
          requestedByAdminUserId:
            actorAdminUserId ?? '00000000-0000-0000-0000-000000000000',
          payload: { productIds: [], fields: {} },
        });
      });
    }

    const bundleServicePublic = new BundleService(options.emFactory, options.commandBus);
    await registerCatalogPublicRoutes(app, {
      queryService,
      ...(options.searchQueryService ? { searchQueryService: options.searchQueryService } : {}),
      productLinkService: productLinkServiceForRead,
      bundleService: bundleServicePublic,
      ...(options.resolveProductImagePlaceholderUrl
        ? { resolveProductImagePlaceholderUrl: options.resolveProductImagePlaceholderUrl }
        : {}),
      // Feature 086 / FR-016 — the route's own refusal reads the page's display
      // mode off the same container the ordering comes from.
      ...(options.pricingService ? { listingPriceOrder: options.pricingService } : {}),
    });
    // Feature 163 (R12) — which product a storefront key names at (C, L). It asks
    // the product page's own reachability decision, so a key never resolves to a
    // product the page would refuse.
    await registerCatalogUrlKeyPublicRoutes(app, {
      resolutionService: new UrlKeyResolutionService(options.emFactory, queryService),
      readContext: readCatalogContext,
    });
    const categoryAdminService = new CategoryAdminService(
      options.emFactory,
      options.salesChannelMembership,
      options.commandBus,
      options.customFieldValues,
      options.eventBus as CategoryEventBus,
      options.assets,
    );

    // Feature 068 — the storefront serves the category tree from a fetch cache
    // tagged `catalog:categories` with a 5-minute TTL, flushed on every category
    // write so an activation toggle is visible immediately. The subscription
    // lives in `backend.ts` and goes through `ctx.subscribe` (issue #107); this
    // is where `app.log` exists, so the revalidator picks it up here.
    options.categoryRevalidator?.setLogger(app.log);
    const attributeSetService = new AttributeSetService(
      options.emFactory,
      options.commandBus,
      attributeReadService,
    );
    const galleryService = new GalleryService(
      options.emFactory,
      options.commandBus,
      options.assets,
      options.salesChannelMembership,
    );
    const attachmentService = new AttachmentService(
      options.emFactory,
      options.commandBus,
      options.assets,
      options.salesChannelMembership,
    );
    const packagingUnitService = new PackagingUnitService(options.emFactory, options.commandBus);
    const productLinkService = new ProductLinkService(
      options.emFactory,
      options.commandBus,
      options.pricingService,
      options.assets,
      options.salesChannelMembership,
      options.organizations,
    );
    const groupedService = new GroupedService(options.emFactory, options.commandBus);
    const bundleService = new BundleService(options.emFactory, options.commandBus);
    await registerCatalogApiKeyRoutes(app, {
      queryService,
      adminService,
      attributeSetService,
      emFactory: options.emFactory,
      ...(options.requireApiKey ? { requireApiKey: options.requireApiKey } : {}),
    });
    // Feature 062 — external catalog namespace (/api/v1/external/catalog/*).
    // Registered only when the api-key gates AND the pricing engine are wired
    // (production + full test harness); legacy fixtures skip it.
    if (
      options.requireApiKey &&
      options.requireBoundApiKey &&
      options.pricingService &&
      options.organizations &&
      // Issue #185 — the assortment check goes through the channel-membership
      // accessor, so the namespace is not mounted without it rather than
      // falling back to a hand-written bridge read.
      options.salesChannelMembership &&
      // Feature 163 (W5 = A) — the bulk-price probe asks availability.
      options.productAvailability
    ) {
      const decorator = new CatalogOrgPriceDecorator({
        emFactory: options.emFactory,
        pricingService: options.pricingService,
        organizations: options.organizations,
        availability: options.productAvailability,
        ...(options.resolveExternalAvailability
          ? { resolveAvailability: options.resolveExternalAvailability }
          : {}),
      });
      await registerCatalogExternalRoutes(app, {
        queryService,
        decorator,
        requireApiKey: options.requireApiKey,
        requireBoundApiKey: options.requireBoundApiKey,
      });
    }
    // Feature 022 — scope editor services. Conditional on the
    // composition root providing both LanguageService and the
    // SalesChannelMembershipPort, since the context endpoint needs
    // both to assemble its response.
    const editorPreferencesService = new ProductEditorPreferencesService(
      options.emFactory,
    );
    // `specs/147-saved-views/` (US2) — the product list's saved views.
    const listViewService = new ProductListViewService(options.emFactory, options.log);
    const valueResolverService = options.languageService
      ? new ProductValueResolverService(
          options.emFactory,
          options.languageService,
          attributeReadService,
        )
      : undefined;

    // Feature 163 — the scope overview (US4) reads membership through the kernel
    // accessor and, for a product in no channel, the active platform languages.
    const scopeOverviewService =
      options.salesChannelMembership && options.languageService && attributeReadService
        ? new ScopeOverviewService(
            options.emFactory,
            options.salesChannelMembership,
            options.languageService,
            attributeReadService,
            options.listSeoProductScopes,
          )
        : undefined;
    // Feature 163 — the FR-090 preview of an attribute's scope-flag change.
    const attributeScopePreviewService = attributeReadService
      ? new AttributeScopePreviewService(options.emFactory, attributeReadService)
      : undefined;
    // Feature 163 / 174 (T039) — URL keys at G, C and C×L, and their redirects: the one key writer.
    const urlKeyService = options.salesChannelMembership
      ? new UrlKeyService(options.emFactory, options.salesChannelMembership, options.commandBus)
      : undefined;
    // Feature 174 — the editor's scoped-values read and save (one Command per save).
    const scopedValuesService =
      options.salesChannelMembership && attributeReadService
        ? new ScopedValuesService(
            options.emFactory,
            {
              membership: options.salesChannelMembership,
              listAttributes: () => attributeReadService.listAll(),
              ...(options.languageService ? { languages: options.languageService } : {}),
              ...(options.assets ? { assets: options.assets } : {}),
              ...(options.organizations ? { organizations: options.organizations } : {}),
              ...(options.readSeoProductScoped ? { readSeo: options.readSeoProductScoped } : {}),
              ...(options.seoProductMetaWrite ? { seoWrite: options.seoProductMetaWrite } : {}),
              gate: completenessGate,
              ...(urlKeyService
                ? {
                    writeUrlKey: (em, input) =>
                      urlKeyService
                        .lockAndCheck(
                          em,
                          input.productId,
                          [{ scope: input.scope, op: input.cell.op.op === 'set' ? { op: 'set', key: String(input.cell.op.value) } : { op: 'inherit' } }],
                          { mode: 'interactive', confirmTakeover: input.confirmTakeover },
                        )
                        .then((effects) => ({ before: effects.before, after: effects.after })),
                  }
                : {}),
            },
            options.commandBus,
          )
        : undefined;

    // Feature 172 — a product's Page Builder content attributes. Needs the
    // Command Bus (every save is the audited `product.content.update`) and the
    // attribute read model (which set members are content attributes).
    const productContentService =
      options.commandBus && attributeReadService
        ? new ProductContentService(options.emFactory, options.commandBus, attributeReadService)
        : undefined;

    await registerCatalogAdminRoutes(app, {
      adminService,
      categoryAdminService,
      ...(productContentService ? { productContentService } : {}),
      attributeSetService,
      galleryService,
      attachmentService,
      packagingUnitService,
      productLinkService,
      groupedService,
      bundleService,
      bulkUpdateService,
      bulkOperationService,
      requireAdmin:
        options.requireAdmin ??
        (() => async () => {
          // no-op gate: development/tests default
        }),
      ...(options.resolveAdminAuditContext
        ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
        : {}),
      ...(options.auditLogService ? { auditLogService: options.auditLogService } : {}),
      productEditorPreferencesService: editorPreferencesService,
      productListViewService: listViewService,
      ...(valueResolverService ? { productValueResolverService: valueResolverService } : {}),
      ...(scopesService ? { productScopesService: scopesService } : {}),
      ...(scopedValuesService ? { scopedValuesService } : {}),
      ...(scopeOverviewService ? { scopeOverviewService } : {}),
      ...(attributeScopePreviewService ? { attributeScopePreviewService } : {}),
      ...(urlKeyService ? { urlKeyService } : {}),
    });

    // Consumer side (Principle X). The BullMQ worker claims each queued
    // operation atomically and runs the idempotent handler. It is a separable
    // entrypoint: co-located here by default (single-VPS posture) but
    // startable as its own process via `pnpm --filter backend run worker`
    // (which sets BACKEND_ROLE so the API process skips this block).
    if (bulkOperationQueue && options.runBulkOperationWorker && options.redis) {
      const svc = bulkOperationService;
      // BullMQ workers issue blocking Redis commands, so they need a
      // dedicated connection rather than the app's shared client.
      const workerConnection = options.redis.duplicate();
      const worker = createBulkOperationWorker(workerConnection, async (job) => {
        app.log.info({ operationId: job.data.operationId }, 'bulk-operation processing started');
        await svc.processById(job.data.operationId);
        app.log.info({ operationId: job.data.operationId }, 'bulk-operation processing finished');
      });
      options.registerWorker(worker, { logger: app.log });
      app.addHook('onClose', async () => {
        await worker.close();
        workerConnection.disconnect();
        await bulkOperationQueue.close();
      });
      // Boot reconciliation: re-enqueue rows left `pending` (e.g. created while
      // the queue was unreachable, or predating this deploy). Not a draining
      // sweeper — it only enqueues onto the durable queue, then returns.
      void svc
        .findPendingIds()
        .then(async (ids) => {
          for (const operationId of ids) {
            await bulkOperationQueue.add(BULK_OPERATION_JOB_NAME, { operationId });
          }
          if (ids.length > 0) {
            app.log.info({ count: ids.length }, 'bulk-operation boot reconciliation enqueued');
          }
        })
        .catch((err: unknown) =>
          app.log.error({ err }, 'bulk-operation boot reconciliation failed'),
        );
    } else if (bulkOperationQueue) {
      // Producer-only process (BACKEND_ROLE=api): close the queue handle on
      // shutdown so its Redis connection is released cleanly.
      app.addHook('onClose', async () => {
        await bulkOperationQueue.close();
      });
    }
  };
}
