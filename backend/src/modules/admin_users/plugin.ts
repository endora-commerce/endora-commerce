import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SessionService } from '../auth/services/session-service.js';
import { AdminAuthService } from './services/admin-auth-service.js';
import { ImpersonationService } from './services/impersonation-service.js';
import { AdminUserService } from './services/admin-user-service.js';
import { AdminRoleService } from '../admin_roles/services/admin-role-service.js';
import { PermissionService } from '../admin_roles/services/permission-service.js';
import { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { registerAdminPublicRoutes } from './routes.public.js';
import { registerImpersonationRoutes } from './routes.impersonation.js';
import { registerAdminUsersAdminRoutes } from './routes.admin.js';
import { registerAuditLogAdminRoutes } from '../audit_logs/routes.admin.js';
import { registerRecentActivityRoutes } from '../audit_logs/routes.admin.recent-activity.js';
import { RecentActivityService } from '../audit_logs/services/recent-activity-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface AdminModuleOptions {
  emFactory: () => EntityManager;
  sessionService: SessionService;
  auditLogService: AuditLogService;
  permissionService: PermissionService;
  requireAdmin: RequireAdminFactory;
  /** Resolves the current admin's id from `request.actor` (prod) or
   *  `request.testActor` (test harness). Used by `GET /admin/me`. */
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

export interface AdminModuleHandle {
  adminAuthService: AdminAuthService;
  impersonationService: ImpersonationService;
  permissionService: PermissionService;
  auditLogService: AuditLogService;
}

/**
 * Admin module composition root. Returns a handle so tests + production
 * boot code can subscribe other modules to AuditLogService etc.
 */
export function adminModule(
  options: AdminModuleOptions,
): { plugin: (app: FastifyInstance) => Promise<void>; handle: AdminModuleHandle } {
  const adminAuthService = new AdminAuthService(options.emFactory, options.sessionService);
  const impersonationService = new ImpersonationService(
    options.emFactory,
    options.sessionService,
    options.auditLogService,
  );
  const handle: AdminModuleHandle = {
    adminAuthService,
    impersonationService,
    permissionService: options.permissionService,
    auditLogService: options.auditLogService,
  };
  const adminUserService = new AdminUserService(options.emFactory);
  const adminRoleService = new AdminRoleService(options.emFactory);
  const recentActivityService = new RecentActivityService(options.emFactory);
  return {
    handle,
    plugin: async (app) => {
      await registerAdminPublicRoutes(app, { adminAuthService });
      await registerImpersonationRoutes(app, {
        impersonationService,
        requireAdmin: options.requireAdmin,
      });
      await registerAdminUsersAdminRoutes(app, {
        adminUserService,
        adminRoleService,
        permissionService: options.permissionService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
      await registerAuditLogAdminRoutes(app, {
        auditLogService: options.auditLogService,
        requireAdmin: options.requireAdmin,
      });
      await registerRecentActivityRoutes(app, {
        recentActivityService,
        requireAdmin: options.requireAdmin,
      });
    },
  };
}
