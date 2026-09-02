import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type {
  AdminPasswordVerificationPort,
  AdminRolePort,
  AdminUserPreferencePort,
  AdminUserReadPort,
  AuthSessionPort,
  CustomerAccountReadPort,
  ImpersonationPort,
  MfaEnrolmentStatePort,
  MfaLoginPort,
  PermissionCataloguePort,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { adminModule } from './plugin.js';
import { AdminUser } from './entities/admin-user.entity.js';
import {
  AdminUserReadService,
  createAdminPasswordVerificationPort,
  createAdminUserPreferencePort,
  createImpersonationPort,
} from './services/admin-user-ports.js';
import type { TwoFactorEnrolmentReader } from './services/two-factor-enrolments.js';

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
  readonly auditLogService: AuditPort;
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

  // The live source of `twoFactorEnabled`, on the same terms as the login port
  // above and for the same reason. This module's own `two_factor_confirmed_at`
  // column has never had a writer, so the field derived from it was a provably
  // constant `false` on `/admin-users`, on `/admin/me` and on the login
  // response the Admin UI seeds its auth context from.
  const mfaEnrolmentStatePort = lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort');

  /**
   * The degrade is performed by **not resolving**, exactly as `getMfaLoginPort`
   * below does it — presence is decided first and there is deliberately no
   * `catch` anywhere near the port. An admin list is the wrong place for a 503,
   * and `false` is not a substitute for the answer here: with `mfa` absent no
   * sign-in asks for a second factor, so no account is protected by one. The
   * sentence an operator is shown before the flip is this module's
   * `degrades-without` entry for `mfaEnrolmentStatePort`.
   */
  const twoFactorEnrolments: TwoFactorEnrolmentReader = async (adminUserIds) => {
    if (!effectiveState.isPresent('mfa')) return new Set<string>();
    return new Set(await mfaEnrolmentStatePort.activeSubjectIds('admin', adminUserIds));
  };

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
          twoFactorEnrolments,
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
      .asFunction(
        ({ emFactory }: AdminUsersCradle) =>
          new AdminUserReadService(emFactory, twoFactorEnrolments),
      )
      .singleton(),
  );

  // Feature 080 (T052) — step-up re-verification, for `mfa`. Both composition
  // roots used to read `passwordHash` off this module's entity and compare it
  // with the platform hasher themselves; the column and the comparison are
  // this module's, so the boolean is what crosses.
  ctx.di.providePort<AdminPasswordVerificationPort>(
    'adminPasswordVerificationPort',
    ctx
      .asFunction(({ emFactory }: AdminUsersCradle) =>
        createAdminPasswordVerificationPort(emFactory),
      )
      .singleton(),
  );

  ctx.di.providePort<AdminUserPreferencePort>(
    'adminUserPreferencePort',
    ctx
      .asFunction(() =>
        createAdminUserPreferencePort(
          () => ctx.cradle<AdminUsersCradle>().adminUserService,
          twoFactorEnrolments,
        ),
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

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table->owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 *
 * The order is the one `db/entities-registry.generated.ts` declared before this
 * module became a package, so the registered set is the same list in the same
 * sequence.
 */
export const entities = [
  AdminUser,
];
