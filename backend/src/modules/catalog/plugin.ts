import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { CommandBus } from '../../commands/index.js';
import { BULK_OPERATION_TYPES } from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
import { defineModuleWorker } from '../_lifecycle/plugin-helpers.js';
import {
  createBulkOperationQueue,
  createBulkOperationWorker,
  BULK_OPERATION_JOB_NAME,
} from './services/bulk-operation-queue.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from './services/catalog-bulk-update.service.js';
import {
  BulkOperationService,
  type SearchReindexRunner,
} from './services/bulk-operation.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
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
import { SearchQueryService } from '../search/services/search-query.service.js';
import type { LanguageService } from '../languages/services/language-service.js';
import type { AdminNotificationService } from '../admin_notifications/services/admin-notification-service.js';
import type { Mailer } from '../email/services/mailer.js';
import { registerCatalogPublicRoutes } from './routes.public.js';
import { registerCatalogAdminRoutes, type RequireAdminFactory } from './routes.admin.js';
import { registerCatalogApiKeyRoutes } from './routes.api-key.js';

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
  languageService?: LanguageService;
  /**
   * In-app (bell) notifications — used by the queued bulk-edit path to
   * tell the requester their background operation finished. Optional;
   * when omitted the notification is simply skipped.
   */
  adminNotificationService?: AdminNotificationService;
  /**
   * Email transport — used by the queued bulk-edit path to email the
   * requester on completion. Optional; when omitted email is skipped.
   */
  mailer?: Mailer;
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
}

export function catalogModule(options: CatalogModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const productLinkServiceForRead = new ProductLinkService(options.emFactory);
    const queryService = new CatalogQueryService(
      options.emFactory,
      productLinkServiceForRead,
    );
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
      options.auditLogService,
      options.salesChannelMembership,
      options.commandBus,
    );
    // SearchQueryService is wired even when the env var picks Postgres so that
    // an operator can flip CATALOG_SEARCH_BACKEND=meilisearch at runtime
    // without restarting (R-08 reserved-fallback still applies). Lifecycle
    // for the indexer + event subscriber lives in `searchModule` (feature
    // 006 / R-3); catalog only owns the read-side adapter here.
    const searchQueryService = new SearchQueryService(options.emFactory);

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

    const bundleServicePublic = new BundleService(options.emFactory);
    await registerCatalogPublicRoutes(app, {
      queryService,
      searchQueryService,
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
    );
    const attributeSetService = new AttributeSetService(options.emFactory);
    const galleryService = new GalleryService(options.emFactory);
    const attachmentService = new AttachmentService(options.emFactory);
    const packagingUnitService = new PackagingUnitService(options.emFactory);
    const productLinkService = new ProductLinkService(options.emFactory);
    const groupedService = new GroupedService(options.emFactory);
    const bundleService = new BundleService(options.emFactory);
    await registerCatalogApiKeyRoutes(app, {
      queryService,
      adminService,
      attributeSetService,
      emFactory: options.emFactory,
      ...(options.requireApiKey ? { requireApiKey: options.requireApiKey } : {}),
    });
    // Feature 022 — scope editor services. Conditional on the
    // composition root providing both LanguageService and the
    // SalesChannelMembershipService, since the context endpoint needs
    // both to assemble its response.
    const editorPreferencesService = new ProductEditorPreferencesService(
      options.emFactory,
    );
    const valueResolverService = options.languageService
      ? new ProductValueResolverService(options.emFactory, options.languageService)
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
      ? new ProductOverridesService(options.emFactory, options.salesChannelMembership)
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
