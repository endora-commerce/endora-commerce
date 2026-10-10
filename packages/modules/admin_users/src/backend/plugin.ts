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
import { AdminUser } from './entities/admin-user.entity.js';
import {
  AuthenticationThrottle,
  type AttemptCounterStore,
  accountWideLimitFromEnvironment,
} from './services/authentication-throttle.js';
import { ImpersonationService } from './services/impersonation-service.js';
import { AdminUserService } from './services/admin-user-service.js';
import type { AuditPort, PlatformLogger } from '@endora-commerce/platform/kernel';
import { registerAdminPublicRoutes } from './routes.public.js';
import { registerImpersonationRoutes } from './routes.impersonation.js';
import { registerAdminUsersAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory, SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { TwoFactorEnrolmentReader } from './services/two-factor-enrolments.js';

/**
 * Every collaborator this module does not own is named by its **container
 * name** and typed by the contract its owner publishes (feature 075, Phase C).
 * The field names are the port names `backend.ts` resolves, so the option
 * object, the `lazyPort` literal and the manifest dependency read as one thing.
 */
export interface AdminModuleOptions {
  emFactory: () => EntityManager;
  /** Where the authentication throttle keeps its counters. */
  redis: AttemptCounterStore;
  /** The module's own logger — a throttle activation is reported on it. */
  log: PlatformLogger;
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
  /**
   * Which admins hold a second factor. Required, not optional: the field it
   * feeds has a value on every response that carries an admin user, and the
   * defect being repaired is exactly what a plausible default produces.
   */
  twoFactorEnrolments: TwoFactorEnrolmentReader;
  /** The kernel's settings reader — the idle-logout policy on `GET /admin/me`. */
  settingsReadPort: SettingsReadPort;
}

export interface AdminModuleHandle {
  adminAuthService: AdminAuthService;
  /**
   * The throttle on wrong passwords and wrong second-factor codes. One
   * instance: sign-in uses it directly, it is what
   * `adminAuthenticationThrottlePort` publishes to `mfa`, and `admin_users
   * unlock` clears one account's counters through it.
   */
  authenticationThrottle: AuthenticationThrottle;
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
  const authenticationThrottle = new AuthenticationThrottle({
    redis: options.redis,
    auditLog: options.auditLogService,
    log: options.log,
    // An instance-level opt-out for demo instances, read once here and warned
    // about on every boot it is active.
    accountWideLimit: accountWideLimitFromEnvironment(
      process.env['ADMIN_AUTH_ACCOUNT_WIDE_LIMIT'],
      options.log,
    ),
    // Read only for a known-device value whose signature a route has verified,
    // and when one is minted. An inactive or deleted account answers `null`,
    // which is what stops its devices being known the moment it is deactivated.
    credentialOf: async (adminUserId) => {
      const admin = await options.emFactory().findOne(AdminUser, {
        id: adminUserId,
        deletedAt: null,
      });
      if (!admin || admin.status !== 'active') return null;
      return { adminUserId: admin.id, email: admin.email, passwordHash: admin.passwordHash };
    },
  });
  const adminAuthService = new AdminAuthService(
    options.emFactory,
    options.authSessionPort,
    authenticationThrottle,
    options.getMfaLoginPort,
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
    options.getMfaLoginPort,
  );
  const handle: AdminModuleHandle = {
    adminAuthService,
    authenticationThrottle,
    impersonationService,
    permissionService: options.permissionService,
    auditLogService: options.auditLogService,
    adminUserService,
  };
  return {
    handle,
    plugin: async (app) => {
      await registerAdminPublicRoutes(app, {
        adminAuthService,
        authenticationThrottle,
        twoFactorEnrolments: options.twoFactorEnrolments,
      });
      await registerImpersonationRoutes(app, {
        impersonationService,
        requireAdmin: options.requireAdmin,
        // The production actor. This route used to read `request.testActor`
        // and 401 whenever it was absent, which is every production request
        // (feature 080, T051) — the module already had the right resolver in
        // hand for `GET /admin/me`.
        resolveAdminUserId: (req) => options.resolveAdminContext(req).adminUserId,
      });
      await registerAdminUsersAdminRoutes(app, {
        adminUserService,
        authenticationThrottle,
        adminRolePort: options.adminRolePort,
        permissionCataloguePort: options.permissionCataloguePort,
        permissionService: options.permissionService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
        twoFactorEnrolments: options.twoFactorEnrolments,
        settingsReadPort: options.settingsReadPort,
      });
    },
  };
}
