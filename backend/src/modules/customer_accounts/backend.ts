import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { withSystemScope } from '../../tenancy/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import { CustomerAccount } from './entities/customer-account.entity.js';
import { PasswordResetToken } from './entities/password-reset-token.entity.js';
import { CustomerAuthService } from './services/customer-auth-service.js';
import { PasswordResetService } from './services/password-reset-service.js';
import { RoleService } from './services/role-service.js';
import { TotpEnrolmentService } from './services/totp-enrolment-service.js';

/**
 * `customer_accounts` — one customer auth service, where there were two
 * (feature 072, wave 1, T094).
 *
 * The module owns no routes: `organizations` serves customer login and
 * registration, `customers` serves the self-service surface. Both built their
 * own `CustomerAuthService`, and the third constructor argument differed:
 *
 *     organizations:  new CustomerAuthService(em, sessions, options.getMfaLoginPort, audit)
 *     customers:      new CustomerAuthService(em, sessions, undefined, audit)
 *                                                          ^ "not wired in the
 *                                                            customers composition"
 *
 * That comment was accurate rather than careless, and this is **not** a live
 * MFA bypass today: `getMfaLoginPort` is consulted only inside `login()`, the
 * single login route lives in `organizations`, and the `customers` instance is
 * used only for `changePassword`. What it is, is the `addresses` shape — two
 * instances of one service that are not required to agree, one of which cannot
 * enforce a second factor. The day a customer-side route needs `login()`, the
 * divergence stops being latent, and nothing in the tree would flag it.
 *
 * `PasswordResetService` was doubled the same way, with identical arguments.
 *
 * Everything here is a **port**: `organizations` and `customers` resolve these
 * services across a module boundary, so an operator switching customer accounts
 * off should get an explicit 503 rather than a service that half-answers.
 *
 * `customerOrgResolver` moves here from `HOST_REGISTERED_PORTS`, where a
 * composition root stood in for this module. `auth` reads it in its request
 * hook to attach the organization to a customer session; the lookup is a plain
 * read of this module's own table, so it belongs to this module and the root's
 * entry goes away.
 */

export const entities = [CustomerAccount, PasswordResetToken];

export interface CustomerAccountsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly sessionService: SessionService;
  /** Late-bound: `mfa` is composed after this module. */
  readonly mfaLoginPortGetter: (() => MfaLoginPort | undefined) | undefined;
  readonly customerAuthService: CustomerAuthService;
  readonly passwordResetService: PasswordResetService;
  readonly customerRoleService: RoleService;
  readonly totpEnrolmentService: TotpEnrolmentService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'customerAuthService',
    ctx
      .asFunction(
        ({ emFactory, sessionService, auditLogService }: CustomerAccountsCradle) =>
          new CustomerAuthService(
            emFactory,
            sessionService,
            // Read through the cradle at call time, not captured: `mfa` is
            // composed later, and a captured `undefined` is exactly the
            // divergence this conversion exists to remove.
            () => ctx.cradle<CustomerAccountsCradle>().mfaLoginPortGetter?.(),
            auditLogService,
          ),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'passwordResetService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: CustomerAccountsCradle) =>
          new PasswordResetService(emFactory, auditLogService),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'customerRoleService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: CustomerAccountsCradle) =>
          new RoleService(emFactory, auditLogService),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'totpEnrolmentService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: CustomerAccountsCradle) =>
          new TotpEnrolmentService(emFactory, auditLogService),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'customerOrgResolver',
    ctx
      .asFunction(
        ({ emFactory }: CustomerAccountsCradle) =>
          async (customerAccountId: string): Promise<string | null> => {
            // Runs in the auth hook, before a tenant context exists, so the
            // read is system-scoped — identity resolution precedes tenancy.
            return withSystemScope('auth: resolve customer org', async () => {
              const customer = await emFactory().findOne(CustomerAccount, {
                id: customerAccountId,
              });
              return customer?.organizationId ?? null;
            });
          },
      )
      .singleton(),
  );

  ctx.di.register({
    // Contribution point: which module supplies the MFA port is a deployment
    // question, and a platform without `mfa` resolves it to nothing rather
    // than failing.
    mfaLoginPortGetter: ctx
      .asFunction((): (() => MfaLoginPort | undefined) | undefined => undefined)
      .singleton(),
  });
}
