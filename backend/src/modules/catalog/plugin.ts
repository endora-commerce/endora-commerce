import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { BULK_OPERATION_TYPES } from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
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
   * Set to `false` to skip the in-process bulk-operation sweeper (tests
   * drive the service directly). Production keeps it on. Mirrors the
   * price-lists status sweeper pattern.
   */
  enableBulkOperationSweeper?: boolean;
  /**
   * Runs a full Meilisearch reindex (the `search:reindex` CLI equivalent).
   * When provided, flipping an attribute's `searchable` flag enqueues a
   * `search_reindex` bulk operation that calls this. Wired from the
   * composition root so catalog stays decoupled from the search module.
   */
  reindexSearchIndexes?: SearchReindexRunner;
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

    // Queued bulk-edit: persists large selections as background
    // operations, drained by the in-process sweeper below. The
    // `onEnqueued` kick makes processing start without waiting for the
    // next interval tick.
    let bulkOperationService: BulkOperationService | undefined;
    const bulkSweeperEnabled = options.enableBulkOperationSweeper !== false;
    bulkOperationService = new BulkOperationService(options.emFactory, bulkUpdateService, {
      ...(options.adminNotificationService
        ? { notificationService: options.adminNotificationService }
        : {}),
      ...(options.mailer ? { mailer: options.mailer } : {}),
      ...(options.reindexSearchIndexes
        ? { reindexRunner: options.reindexSearchIndexes }
        : {}),
      onEnqueued: bulkSweeperEnabled
        ? (): void => {
            bulkOperationService
              ?.processPending()
              .catch((err: unknown) => app.log.error({ err }, 'bulk-operation drain failed'));
          }
        : (): void => {
            /* sweeper disabled (tests) — drain is driven manually */
          },
    });

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
    });
    const categoryAdminService = new CategoryAdminService(
      options.emFactory,
      options.salesChannelMembership,
    );
    const attributeSetService = new AttributeSetService(options.emFactory);
    const galleryService = new GalleryService(options.emFactory);
    const attachmentService = new AttachmentService(options.emFactory);
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

    // In-process sweeper for queued bulk operations. Mirrors the
    // price-lists status sweeper: a periodic drain catches anything the
    // create-time `onEnqueued` kick missed (e.g. work left pending across
    // a restart). Unref'd so it never keeps the process alive, and torn
    // down on close.
    if (bulkSweeperEnabled) {
      const svc = bulkOperationService;
      const handle = setInterval(() => {
        svc
          .processPending()
          .then((res) => {
            if (res.processed > 0) {
              app.log.info({ res }, 'bulk-operation sweep drained pending operations');
            }
          })
          .catch((err: unknown) => {
            app.log.error({ err }, 'bulk-operation sweep failed');
          });
      }, BULK_OPERATION_SWEEP_INTERVAL_MS);
      if (typeof handle.unref === 'function') handle.unref();
      app.addHook('onClose', async () => {
        clearInterval(handle);
      });
      // Drain anything already pending at boot.
      svc
        .processPending()
        .catch((err: unknown) => app.log.error({ err }, 'bulk-operation boot drain failed'));
    }
  };
}

/** How often the queued bulk-operation sweeper drains pending rows. */
const BULK_OPERATION_SWEEP_INTERVAL_MS = 10_000;
