import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminRolePort,
  AuthSessionPort,
  CustomerAccountReadPort,
  MfaLoginPort,
  PermissionCataloguePort,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import { AdminAuthService } from './services/admin-auth-service.js';
import { ImpersonationService } from './services/impersonation-service.js';
import { AdminUserService } from './services/admin-user-service.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import { registerAdminPublicRoutes } from './routes.public.js';
import { registerImpersonationRoutes } from './routes.impersonation.js';
import { registerAdminUsersAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Every collaborator this module does not own is named by its **container
 * name** and typed by the contract its owner publishes (feature 075, Phase C).
 * The field names are the port names `backend.ts` resolves, so the option
 * object, the `lazyPort` literal and the manifest dependency read as one thing.
 */
export interface AdminModuleOptions {
  emFactory: () => EntityManager;
  /** `auth`'s session surface — mints, loads and destroys the session rows. */
  authSessionPort: AuthSessionPort;
  auditLogService: AuditPort;
  /** `admin_roles` — the effective permission codes of one admin user. */
  permissionService: PermissionReadPort;
  /** `admin_roles` — the codes an operator may actually grant. */
  permissionCataloguePort: PermissionCataloguePort;
  /**
   * Required since feature 072 (T121). It was optional with an in-module
   * fallback that built a second `AdminRoleService`; both compositions passed
   * `admin_roles`' own instance, and the fallback would have written role
   * changes through a different audit path than `/admin-roles` reads.
   */
  adminRolePort: AdminRolePort;
  /** `customer_accounts` — who an impersonation is started against. */
  customerAccountReadPort: CustomerAccountReadPort;
  requireAdmin: RequireAdminFactory;
  /** Resolves the current admin's id from `request.actor` (prod) or
   *  `request.testActor` (test harness). Used by `GET /admin/me`. */
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  /** Feature 042 — lazily resolved MFA login port (absent ⇒ password-only). */
  getMfaLoginPort?: () => MfaLoginPort | undefined;
}

export interface AdminModuleHandle {
  adminAuthService: AdminAuthService;
  impersonationService: ImpersonationService;
  permissionService: PermissionReadPort;
  auditLogService: AuditPort;
  /**
   * Exposed so a composition root can contribute `auditActorResolver` to
   * `audit_logs` (feature 072, T084). That module used to be mounted from
   * inside this plugin and reached `listByIds` directly; it owns its routes
   * now, and identity lookup is the one thing it still wants from here.
   */
  adminUserService: AdminUserService;
}

/**
 * Admin module composition root. Returns a handle so tests + production
 * boot code can subscribe other modules to AuditPort etc.
 */
export function adminModule(
  options: AdminModuleOptions,
): { plugin: (app: FastifyInstance) => Promise<void>; handle: AdminModuleHandle } {
  const adminAuthService = new AdminAuthService(
    options.emFactory,
    options.authSessionPort,
    options.getMfaLoginPort,
    options.auditLogService,
  );
  const impersonationService = new ImpersonationService(
    options.emFactory,
    options.authSessionPort,
    options.customerAccountReadPort,
    options.auditLogService,
  );
  const adminUserService = new AdminUserService(
    options.emFactory,
    options.adminRolePort,
    options.authSessionPort,
    options.auditLogService,
  );
  const handle: AdminModuleHandle = {
    adminAuthService,
    impersonationService,
    permissionService: options.permissionService,
    auditLogService: options.auditLogService,
    adminUserService,
  };
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
        adminRolePort: options.adminRolePort,
        permissionCataloguePort: options.permissionCataloguePort,
        permissionService: options.permissionService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
    },
  };
}
