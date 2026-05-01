import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import { AttributeSetService } from './services/attribute-set.service.js';
import { GalleryService } from './services/gallery.service.js';
import { AttachmentService } from './services/attachment.service.js';
import { ProductLinkService } from './services/product-link.service.js';
import { GroupedService } from './services/grouped.service.js';
import { BundleService } from './services/bundle.service.js';
import { SearchQueryService } from '../search/services/search-query.service.js';
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
    await registerCatalogAdminRoutes(app, {
      adminService,
      categoryAdminService,
      attributeSetService,
      galleryService,
      attachmentService,
      productLinkService,
      groupedService,
      bundleService,
      requireAdmin:
        options.requireAdmin ??
        (() => async () => {
          // no-op gate: development/tests default
        }),
      ...(options.resolveAdminAuditContext
        ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
        : {}),
      ...(options.auditLogService ? { auditLogService: options.auditLogService } : {}),
    });
  };
}
