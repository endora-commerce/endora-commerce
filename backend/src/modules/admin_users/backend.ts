import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type {
  AdminRolePort,
  AdminUserPreferencePort,
  AdminUserReadPort,
  AuthSessionPort,
  CustomerAccountReadPort,
  ImpersonationPort,
  MfaLoginPort,
  PermissionCataloguePort,
  PermissionReadPort,
} from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { adminModule } from './plugin.js';
import {
  AdminUserReadService,
  createAdminUserPreferencePort,
  createImpersonationPort,
} from './services/admin-user-ports.js';

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
 * **The MFA port is a `degrades-without` edge this module resolves itself**
 * (D-96). Absent, admin login is password-only, which is a real deployment
 * rather than a broken one; declaring `mfa` in `dependencies` would make the
 * lifecycle refuse to disable MFA while admin login is on, which is backwards —
 * and `mfa` declares *this* module, so the ordinary declaration would close a
 * cycle. The manifest says so in `nonBindingDependencies` instead, and the
 * probe below is what that declaration is held to.
 *
 * It used to be a contribution both roots filled from one getter, which is how
 * a gated port came to be resolved on this module's behalf (composition
 * checklist item 6) — and how the harness came to capture the gate at compose
 * time, so no off-state test could observe `mfa` switched off at all.
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
  readonly authSessionPort: AuthSessionPort;
  readonly permissionService: PermissionReadPort;
  readonly permissionCataloguePort: PermissionCataloguePort;
  readonly adminRolePort: AdminRolePort;
  readonly customerAccountReadPort: CustomerAccountReadPort;
  readonly admin: ReturnType<typeof adminModule>;
  readonly adminUserService: ReturnType<typeof adminModule>['handle']['adminUserService'];
}

export function registerModule(ctx: ModuleContext): void {
  // D-96 — resolved once, called through on every login. The gate `mfa`'s
  // `providePort` put on this name is transient, so the proxy asks about the
  // module's effective state at each call rather than at composition.
  const mfaLoginPort = lazyPort<MfaLoginPort>(ctx, 'mfaLoginPort');

  ctx.di.register({
    admin: ctx
      .asFunction(({ emFactory, auditLogService }: AdminUsersCradle) =>
        adminModule({
          emFactory,
          auditLogService,
          // Feature 075, Phase C — every collaborator below is another
          // module's published port, resolved lazily by a string literal so
          // the gate answers per call and nothing captures it.
          authSessionPort: lazyPort<AuthSessionPort>(ctx, 'authSessionPort'),
          permissionService: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
          permissionCataloguePort: lazyPort<PermissionCataloguePort>(
            ctx,
            'permissionCataloguePort',
          ),
          adminRolePort: lazyPort<AdminRolePort>(ctx, 'adminRolePort'),
          customerAccountReadPort: lazyPort<CustomerAccountReadPort>(
            ctx,
            'customerAccountReadPort',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<AdminUsersCradle>().requireAdmin(permission)(req, reply),
          resolveAdminContext: (req) => ctx.cradle<AdminUsersCradle>().adminContextResolver(req),
          // D-96 — the degrade is performed by **not resolving**. The port's
          // gate throws `ModuleDisabledError` when `mfa` is absent, and there
          // is deliberately no `catch` anywhere near this: a caught gate is a
          // fail-open degrade nobody declared. Deciding presence first is the
          // `auth`/`api_keys` shape, and `AdminAuthService`'s `if (mfaPort)`
          // branch — the password-only fallback of feature 042 FR-033 — is what
          // `undefined` selects.
          getMfaLoginPort: () => (effectiveState.isPresent('mfa') ? mfaLoginPort : undefined),
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'adminUserService',
    ctx.asFunction(({ admin }: AdminUsersCradle) => admin.handle.adminUserService).singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // Seven of the eleven inbound sites read the `AdminUser` **entity** to put a
  // name beside an id, and none of them wants a service: `admin_roles`
  // resolving a user's role, `quote_requests` listing the admins a
  // notification fans out to, `catalog` attributing a bulk operation,
  // `organizations` rendering the sales-rep picker. `adminUserReadPort` is
  // that read.
  //
  // The two adapters narrow the module's services to what one consumer each
  // calls — `_i18n` writes a language preference, `customers` starts and ends
  // an impersonation — and neither hands an entity across.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<AdminUserReadPort>(
    'adminUserReadPort',
    ctx
      .asFunction(({ emFactory }: AdminUsersCradle) => new AdminUserReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<AdminUserPreferencePort>(
    'adminUserPreferencePort',
    ctx
      .asFunction(() =>
        createAdminUserPreferencePort(() => ctx.cradle<AdminUsersCradle>().adminUserService),
      )
      .singleton(),
  );

  ctx.di.providePort<ImpersonationPort>(
    'impersonationPort',
    ctx
      .asFunction(({ admin }: AdminUsersCradle) =>
        createImpersonationPort(() => admin.handle.impersonationService),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<AdminUsersCradle>().admin.plugin(app);
  });
}
