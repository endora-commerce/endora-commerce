import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { SearchQueryService } from '../search/services/search-query.service.js';
import { SearchIndexer } from '../search/services/search-indexer.js';
import { SearchEventSubscriber } from '../search/services/search-event-subscriber.js';
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
   * Subscribe the SearchEventSubscriber to product/attribute events so the
   * Meilisearch index incrementally tracks Postgres mutations (T067).
   * Defaults to `false` so tests that don't have Meilisearch up don't pay
   * the per-mutation outbound HTTP cost. Production composition roots set
   * this to `true`.
   */
  enableSearchEventSubscriber?: boolean;
}

export function catalogModule(options: CatalogModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const queryService = new CatalogQueryService(options.emFactory);
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
      options.auditLogService,
    );
    // SearchQueryService is wired even when the env var picks Postgres so that
    // an operator can flip CATALOG_SEARCH_BACKEND=meilisearch at runtime
    // without restarting (R-08 reserved-fallback still applies).
    const searchQueryService = new SearchQueryService(options.emFactory);

    if (options.enableSearchEventSubscriber) {
      const indexer = new SearchIndexer();
      const subscriber = new SearchEventSubscriber({
        eventBus: options.eventBus as never,
        emFactory: options.emFactory,
        indexer,
      });
      const teardown = subscriber.subscribe();
      app.addHook('onClose', async () => teardown());
    }

    await registerCatalogPublicRoutes(app, { queryService, searchQueryService });
    await registerCatalogApiKeyRoutes(app, {
      queryService,
      adminService,
      emFactory: options.emFactory,
      ...(options.requireApiKey ? { requireApiKey: options.requireApiKey } : {}),
    });
    await registerCatalogAdminRoutes(app, {
      adminService,
      requireAdmin:
        options.requireAdmin ??
        (() => async () => {
          // no-op gate: development/tests default
        }),
      ...(options.resolveAdminAuditContext
        ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
        : {}),
    });
  };
}
