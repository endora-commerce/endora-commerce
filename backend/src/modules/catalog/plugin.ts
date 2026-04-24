import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { registerCatalogPublicRoutes } from './routes.public.js';
import { registerCatalogAdminRoutes, type RequireAdminFactory } from './routes.admin.js';

/**
 * Composition root for the catalog module. Wires the ORM's per-request EM into
 * the query/admin services and registers the public + admin routes.
 */

export interface CatalogModuleOptions {
  /** Factory returning the EntityManager for the current request/transaction. */
  emFactory: () => EntityManager;
  /** Shared event bus — catalog publishes product.created.v1 / product.updated.v1 / attribute.updated.v1 here. */
  eventBus: EventBus;
  /**
   * Pre-handler gate for admin routes. Supplied by the composition root so the
   * catalog module has no dependency on the auth plugin's exact shape.
   * Defaults to a permissive allow-all (useful only for local development and
   * tests where the actor is otherwise irrelevant).
   */
  requireAdmin?: RequireAdminFactory;
}

export function catalogModule(options: CatalogModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const queryService = new CatalogQueryService(options.emFactory);
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
    );

    await registerCatalogPublicRoutes(app, { queryService });
    await registerCatalogAdminRoutes(app, {
      adminService,
      requireAdmin:
        options.requireAdmin ??
        (() => async () => {
          // no-op gate: development/tests default
        }),
    });
  };
}
