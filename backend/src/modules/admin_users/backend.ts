import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import type { SessionService } from '../auth/services/session-service.js';
import { adminModule, type AdminModuleOptions } from './plugin.js';

/**
 * `admin_users` — who the admin is, and who is allowed to say so (feature 072,
 * wave 2, T121).
 *
 * Four of its five services came from other modules and are ports now:
 * `sessionService` from `auth`, and `permissionService`,
 * `permissionCatalogueService` and `adminRoleService` from `admin_roles`. The
 * last was optional, with a fallback that built a second `AdminRoleService`
 * inside this module — a shape neither composition ever ran, and one that would
 * have written role changes through a different audit path than the one
 * `/admin-roles` reads.
 *
 * **The MFA port is a contribution, not a dependency.** Absent, admin login is
 * password-only, which is a real deployment rather than a broken one; declaring
 * `mfa` in `dependencies` would make the lifecycle refuse to disable MFA while
 * admin login is on, which is backwards. `customer_accounts` owns the same
 * shape under `mfaLoginPortGetter` (T094) — the name is per-consumer because a
 * contribution point belongs to the module that declares it, and both roots
 * fill the two from the one late-bound getter they already hold.
 *
 * **`auditActorResolver` stays a root contribution**, against the prediction in
 * `audit_logs/backend.ts` that it would move here. `audit_logs` owns that name
 * and defaults it absent, and the generated composer runs `admin_users` before
 * `audit_logs` — so a registration here would be overwritten by the owner's
 * default a moment later. What the conversion does buy is the gate: the root's
 * adapter now reads the `adminUserService` **port**, whose own gate raises
 * `ModuleDisabledError` when this module is off, so no composition root has to
 * hard-code `isPresent('admin_users')` to decide it.
 */

/** What `admin_users` resolves from the container, and the names it owns. */
export interface AdminUsersCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  /** Who the acting admin is — production reads `actor`, the harness `testActor`. */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly sessionService: SessionService;
  readonly permissionService: AdminModuleOptions['permissionService'];
  readonly permissionCatalogueService: AdminModuleOptions['permissionCatalogueService'];
  readonly adminRoleService: NonNullable<AdminModuleOptions['adminRoleService']>;
  /**
   * Contribution point: absent means admin login is password-only. Late-bound
   * because `mfa` composes after this module.
   */
  readonly adminMfaLoginPortGetter: (() => MfaLoginPort | undefined) | undefined;
  readonly admin: ReturnType<typeof adminModule>;
  readonly adminUserService: ReturnType<typeof adminModule>['handle']['adminUserService'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, absent by default: password-only admin login.
    adminMfaLoginPortGetter: ctx
      .asFunction((): AdminUsersCradle['adminMfaLoginPortGetter'] => undefined)
      .singleton(),

    admin: ctx
      .asFunction(({ emFactory, auditLogService }: AdminUsersCradle) =>
        adminModule({
          emFactory,
          auditLogService,
          sessionService: lazyPort<SessionService>(ctx, 'sessionService'),
          permissionService: lazyPort<AdminUsersCradle['permissionService']>(
            ctx,
            'permissionService',
          ),
          permissionCatalogueService: lazyPort<AdminUsersCradle['permissionCatalogueService']>(
            ctx,
            'permissionCatalogueService',
          ),
          adminRoleService: lazyPort<AdminUsersCradle['adminRoleService']>(
            ctx,
            'adminRoleService',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<AdminUsersCradle>().requireAdmin(permission)(req, reply),
          resolveAdminContext: (req) => ctx.cradle<AdminUsersCradle>().adminContextResolver(req),
          // Read through the cradle at call time, not captured: `mfa` composes
          // later, and a captured `undefined` would pin every login to
          // password-only for the life of the process.
          getMfaLoginPort: () => ctx.cradle<AdminUsersCradle>().adminMfaLoginPortGetter?.(),
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'adminUserService',
    ctx.asFunction(({ admin }: AdminUsersCradle) => admin.handle.adminUserService).singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<AdminUsersCradle>().admin.plugin(app);
  });
}
