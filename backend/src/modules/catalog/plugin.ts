import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { CommandBus } from '../../commands/index.js';
import {
  BULK_OPERATION_TYPES,
  type AssetReadPort,
  type SearchQueryPort,
  type AdminUserReadPort,
  type EmailMailerPort,
  type LanguageReadPort,
  type ListingPricePort,
  type OrgLinePricePort,
  type CustomFieldDefinitionReadPort,
  type CustomFieldValuePort,
  type OrganizationDetailsPort,
} from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
import type { StorefrontRevalidator } from '../../http/storefront-revalidator.js';
import { defineModuleWorker } from '../../kernel/lifecycle/plugin-helpers.js';
import {
  createBulkOperationQueue,
  createBulkOperationWorker,
  BULK_OPERATION_JOB_NAME,
} from './services/bulk-operation-queue.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import {
  CatalogAdminService,
  type CatalogCustomFieldsPort,
  type CatalogEventBus,
} from './services/catalog-admin.service.js';
import { CatalogAttributeReadService } from './services/catalog-attribute-read.service.js';
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
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { PackagingUnitService } from './services/packaging-unit.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { BundleService } from './services/bundle.service.js';
import { ProductEditorPreferencesService } from './services/product-editor-preferences.service.js';
import { ProductOverridesService } from './services/product-overrides.service.js';
import { ProductScopeContextService } from './services/product-scope-context.service.js';
import { ProductValueResolverService } from './services/product-value-resolver.service.js';
import { registerCatalogPublicRoutes } from './routes.public.js';
import { registerCatalogAdminRoutes } from './routes.admin.js';
import { registerCatalogApiKeyRoutes } from './routes.api-key.js';
import { registerCatalogExternalRoutes } from './routes.external.js';
import {
  CatalogOrgPriceDecorator,
  type ResolveAvailabilityPort,
} from './services/catalog-org-price-decorator.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

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
   * Feature 068 — flushes the storefront's `catalog:categories` fetch-cache tag.
   * Owned by `backend.ts`, which also owns the `category.updated.v1`
   * subscription that drives it; passed here only so it can pick up `app.log`
   * once the Fastify instance exists.
   */
  categoryRevalidator?: StorefrontRevalidator;
  requireAdmin?: RequireAdminFactory;
  /** Audit-log writer; if provided, mutations land an AuditLogEntry. */
  auditLogService?: AuditLogService;
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
  pricingService?: OrgLinePricePort & ListingPricePort;
  /**
   * Feature 062 — inventory availability port for the external namespace's
   * `availability` indication. Optional: when omitted the field is omitted.
   */
  resolveExternalAvailability?: ResolveAvailabilityPort;
  /**
   * Feature 075 — `organizations`' read port. The external namespace's price
   * decoration resolves the calling organisation through it, where it used to
   * run `em.findOne(Organization, …)` against another module's table.
   */
  organizations?: OrganizationDetailsPort;
  /**
   * Feature 075 — `admin_users`' read port, for the one row the bulk-operation
   * completion notice reads: the requester's e-mail address.
   */
  adminUsers?: AdminUserReadPort;
  /**
   * Feature 005 / T027 — when provided, every newly-created Product is
   * automatically bound to the system-default Sales Channel unless it
   * already had memberships set through some other path (FR-011).
   * Production composition.ts always provides this; tests omit it for
   * pre-feature-005 fixtures.
   */
  salesChannelMembership?: SalesChannelMembershipService;
  /**
   * Feature 022 — language admin service used by the product scope
   * editor's scope-context endpoint (for the primary admin language)
   * and the resolver service (for the same). Optional: when omitted,
   * the new admin endpoints are NOT registered.
   */
  languageService?: LanguageReadPort;
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
   * model and, when it satisfies {@link CatalogCustomFieldsPort}, the
   * attribute write path (apply seam).
   */
  customFieldDefinitions?: CustomFieldDefinitionReadPort;
  /**
   * Feature 061 — the custom_fields apply seam + committed-state read used by
   * the attribute Commands. Production + test composition pass the
   * `CustomFieldDefinitionService` here (it satisfies the port structurally).
   */
  customFieldsPort?: CatalogCustomFieldsPort;
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
    );
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
      options.auditLogService,
      options.salesChannelMembership,
      options.commandBus,
      attributeReadService,
      options.customFieldsPort,
    );
    const bulkUpdateService = new CatalogBulkUpdateService(
      options.emFactory,
      adminService,
      options.salesChannelMembership,
      options.auditLogService,
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
      ...(options.adminNotificationService
        ? { notificationService: options.adminNotificationService }
        : {}),
      ...(options.mailer ? { mailer: options.mailer } : {}),
      ...(options.adminUsers ? { adminUsers: options.adminUsers } : {}),
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
    });
    const categoryAdminService = new CategoryAdminService(
      options.emFactory,
      options.salesChannelMembership,
      options.commandBus,
      options.customFieldValues,
      options.eventBus as CategoryEventBus,
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
    );
    const attachmentService = new AttachmentService(
      options.emFactory,
      options.commandBus,
      options.assets,
    );
    const packagingUnitService = new PackagingUnitService(options.emFactory, options.commandBus);
    const productLinkService = new ProductLinkService(
      options.emFactory,
      options.commandBus,
      options.pricingService,
      options.assets,
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
      options.organizations
    ) {
      const decorator = new CatalogOrgPriceDecorator({
        emFactory: options.emFactory,
        pricingService: options.pricingService,
        organizations: options.organizations,
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
    // SalesChannelMembershipService, since the context endpoint needs
    // both to assemble its response.
    const editorPreferencesService = new ProductEditorPreferencesService(
      options.emFactory,
    );
    const valueResolverService = options.languageService
      ? new ProductValueResolverService(
          options.emFactory,
          options.languageService,
          attributeReadService,
        )
      : undefined;
    const scopeContextService =
      options.salesChannelMembership && options.languageService
        ? new ProductScopeContextService(
            options.emFactory,
            options.salesChannelMembership,
            options.languageService,
            editorPreferencesService,
          )
        : undefined;
    const overridesService = options.salesChannelMembership
      ? new ProductOverridesService(
          options.emFactory,
          options.salesChannelMembership,
          options.commandBus,
          attributeReadService,
        )
      : undefined;

    await registerCatalogAdminRoutes(app, {
      adminService,
      categoryAdminService,
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
      ...(scopeContextService ? { productScopeContextService: scopeContextService } : {}),
      productEditorPreferencesService: editorPreferencesService,
      ...(valueResolverService ? { productValueResolverService: valueResolverService } : {}),
      ...(overridesService ? { productOverridesService: overridesService } : {}),
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
      const worker = defineModuleWorker(
        'catalog',
        createBulkOperationWorker(workerConnection, async (job) => {
          app.log.info(
            { operationId: job.data.operationId },
            'bulk-operation processing started',
          );
          await svc.processById(job.data.operationId);
          app.log.info(
            { operationId: job.data.operationId },
            'bulk-operation processing finished',
          );
        }),
        { logger: app.log },
      );
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
