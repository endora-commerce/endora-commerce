import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { CatalogQueryService } from './services/catalog-query.service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { registerCatalogPublicRoutes } from './routes.public.js';
import { registerCatalogAdminRoutes, type RequireAdminFactory } from './routes.admin.js';

/**
 * Composition root for the catalog module. Wires the ORM's per-request EM into
 * the query/admin services and registers the public + admin routes.
 */

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
}

export function catalogModule(options: CatalogModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const queryService = new CatalogQueryService(options.emFactory);
    const adminService = new CatalogAdminService(
      options.emFactory,
      options.eventBus as CatalogEventBus,
      options.auditLogService,
    );

    await registerCatalogPublicRoutes(app, { queryService });
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
