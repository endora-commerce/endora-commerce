import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { normalizeEmailAddress } from '@endora-commerce/contracts';
import type { AuditReferenceRegistryPort, OrganizationDetailsPort } from '@endora-commerce/contracts';
import type {
  AuthSessionPort,
  CustomerAccountAdminSearchPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
  CustomerAuthPort,
  CustomerGroupReadPort,
  CustomerPasswordResetPort,
  CustomerPasswordStatePort,
  CustomerRolePort,
  CustomerTotpEnrolmentPort,
  MfaLoginPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { CommandBus } from '../../commands/index.js';
import { recordAuditFromContext } from '../../commands/index.js';
import { withSystemScope } from '../../tenancy/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { registerCustomerAccountAuditReferences } from './services/audit-references.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsReadPort } from '../../kernel/ports/settings.js';
// Feature 075, Phase C — a pure function, so the kernel rather than `auth`.
import { hashPassword } from '../../kernel/crypto/password-hasher.js';
import { CustomerAccount } from './entities/customer-account.entity.js';
import { registerCustomerGroupAdminRoutes } from './routes.admin.js';
import {
  CustomerAccountMemberWriteService,
  CustomerAccountReadService,
  CustomerPasswordStateService,
  createCustomerAuthPort,
  createCustomerRolePort,
} from './services/customer-account-ports.js';
import {
  CustomerAccountAdminSearchService,
  CustomerAccountLifecycleWriteService,
} from './services/customer-account-lifecycle-ports.js';
import { CustomerAuthService } from './services/customer-auth-service.js';
import { CustomerGroupReadService } from './services/customer-group-read-port.js';
import { CustomerGroupService } from './services/customer-group-service.js';
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
 * **The MFA port is resolved here now, behind a presence probe** (D-96). It was
 * a contribution both roots filled from one getter — a root resolving a gated
 * port on this module's behalf, which is composition checklist item 6 — and the
 * harness captured that gate at compose time, so `mfa` switched off was
 * unobservable. The edge is declared `degrades-without` in this module's
 * manifest: `mfa` declares `customer_accounts`, so the ordinary declaration
 * would close a cycle and would make customer login refuse the operator's flip.
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
 *
 * **Social-login account creation came home in T143a cluster 6, and the two
 * roots disagreed about what it does.** Both wrote `mfaSocialAccountResolvers`
 * closures that read and created rows in this module's table. Production gated
 * the creation on `customers.allow_registration_without_organization`, which
 * ships **off**; the harness gated it on nothing, so federated sign-in
 * auto-created an account in every test run and the gate itself was covered by
 * no test — a policy the platform has and the suite denied. Production
 * system-scoped the identity read (tenancy comes after identity) and the
 * harness did not, and production minted a random password where the harness
 * hashed one fixed string for every auto-created account. One implementation
 * now, and it is this module's, because the table is.
 */

export interface CustomerAccountsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  /** Feature 054 — the customer-group writes audit co-transactionally. */
  readonly commandBus: CommandBus;
  /** `auth`'s admin guard, for the customer-group admin routes. */
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SettingsReadPort;
  /**
   * Which channel a global-scope settings read resolves against — the
   * deployment's system-default channel. A property of the deployment, so a
   * root supplies it; `inventory` reads the same name.
   */
  readonly settingsChannelResolver: () => Promise<string | null>;
  /**
   * The two customer-side halves of `mfa`'s `SocialIdentityDeps` (T143a): match
   * a verified provider e-mail to an account, and create one when nothing
   * matches and the platform allows an org-less registration.
   */
  readonly customerSocialLoginPort: {
    resolveByEmail(email: string): Promise<{ id: string } | null>;
    autoCreate(email: string): Promise<{ id: string } | null>;
  };
  readonly customerAuthService: CustomerAuthService;
  readonly passwordResetService: PasswordResetService;
  readonly customerRoleService: RoleService;
  readonly totpEnrolmentService: TotpEnrolmentService;
  readonly customerGroupService: CustomerGroupService;
}

export function registerModule(ctx: ModuleContext): void {
  // D-96 — resolved once, called through on every login. The gate `mfa`'s
  // `providePort` put on this name is transient, so the proxy asks about the
  // module's effective state at each call rather than at composition.
  const mfaLoginPort = lazyPort<MfaLoginPort>(ctx, 'mfaLoginPort');

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // The four ports below this block already existed; what they lacked was a
  // contract a consumer could name without naming a file in this directory.
  // Two of them (`passwordResetService`, `totpEnrolmentService`) already return
  // plain shapes, so they gain nothing but a type parameter, which is now the
  // compile-time proof that they still satisfy what was published.
  //
  // The other two return the `CustomerAccount` **entity**, and an entity
  // crossing a boundary is the problem this feature exists to remove — so they
  // get record-returning siblings rather than a rename. `customerAuthPort` and
  // `customerRolePort` are what the consumers rewired to — `customers` was the
  // last of them, in issue #195 — and `customerAuthService` /
  // `customerRoleService` stay registered because those two adapters are built
  // over them.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<CustomerAccountReadPort>(
    'customerAccountReadPort',
    ctx
      .asFunction(({ emFactory }: CustomerAccountsCradle) => new CustomerAccountReadService(emFactory))
      .singleton(),
  );

  /**
   * Feature 075, Phase C — the member lifecycle `organizations` runs over this
   * table. Published when that module was cut: it created and mutated the
   * entity in seven places, and the argon2 hash it needed to do so came from an
   * import of `auth`. Both are on this side of the port now, and each write
   * records its own audit row, as `roleService` beside it always has.
   */
  ctx.di.providePort<CustomerAccountMemberWritePort>(
    'customerAccountMemberWritePort',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: CustomerAccountsCradle) =>
          new CustomerAccountMemberWriteService(emFactory, auditLogService),
      )
      .singleton(),
  );

  /**
   * Feature 075, Phase C — the account lifecycle `customers` runs over this
   * table, and the list its admin screen reads it with.
   *
   * `customers` is the management surface over these accounts and it ran both
   * by holding the entity: block, unblock, soft-delete, restore, the retention
   * sweep's scrub, the organisation and group assignments, standalone
   * registration and the custom-field patch, plus the paginated admin query.
   * The policy — who may act on whom, and the "an organisation keeps an
   * administrator" guard — stayed on that side; the statement and its one audit
   * row are here.
   */
  ctx.di.providePort<CustomerAccountLifecycleWritePort>(
    'customerAccountLifecycleWritePort',
    ctx
      .asFunction(
        ({ emFactory, auditLogService, commandBus }: CustomerAccountsCradle) =>
          new CustomerAccountLifecycleWriteService(emFactory, auditLogService, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CustomerAccountAdminSearchPort>(
    'customerAccountAdminSearchPort',
    ctx
      .asFunction(
        ({ emFactory }: CustomerAccountsCradle) => new CustomerAccountAdminSearchService(emFactory),
      )
      .singleton(),
  );

  ctx.di.providePort<CustomerAuthPort>(
    'customerAuthPort',
    ctx
      .asFunction(() =>
        createCustomerAuthPort(() => ctx.cradle<CustomerAccountsCradle>().customerAuthService),
      )
      .singleton(),
  );

  /**
   * Issue #222 — whether a password its holder can use is on record. Read by
   * `mfa` before it severs an account's last federated identity; nothing else
   * needs it, which is why it is its own port rather than a field on
   * `customerAccountReadPort`'s record.
   */
  ctx.di.providePort<CustomerPasswordStatePort>(
    'customerPasswordStatePort',
    ctx
      .asFunction(
        ({ emFactory }: CustomerAccountsCradle) => new CustomerPasswordStateService(emFactory),
      )
      .singleton(),
  );

  ctx.di.providePort<CustomerRolePort>(
    'customerRolePort',
    ctx
      .asFunction(() =>
        createCustomerRolePort(() => ctx.cradle<CustomerAccountsCradle>().customerRoleService),
      )
      .singleton(),
  );

  ctx.di.providePort(
    'customerAuthService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: CustomerAccountsCradle) =>
          new CustomerAuthService(
            emFactory,
            // Feature 075, Phase C — `auth`'s **published** session surface,
            // where this used to resolve the `sessionService` registration and
            // type itself against `auth`'s class. The port hands back a plain
            // cookie payload; the `Session` entity no longer crosses.
            lazyPort<AuthSessionPort>(ctx, 'authSessionPort'),
            // D-96 — the degrade is performed by **not resolving**. The port's
            // gate throws `ModuleDisabledError` when `mfa` is absent, and there
            // is deliberately no `catch` anywhere near this: a caught gate is a
            // fail-open degrade nobody declared. Deciding presence first is the
            // `auth`/`api_keys` shape, and `CustomerAuthService`'s
            // `if (mfaPort)` branch — the password-only fallback of feature 042
            // FR-033 — is what `undefined` selects.
            () => (effectiveState.isPresent('mfa') ? mfaLoginPort : undefined),
            auditLogService,
          ),
      )
      .singleton(),
  );

  // The type parameter is the compile-time proof that this service still
  // satisfies what feature 075 published; it returns plain shapes already, so
  // it needed no adapter.
  ctx.di.providePort<CustomerPasswordResetPort>(
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

  ctx.di.providePort<CustomerTotpEnrolmentPort>(
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

  /**
   * Federated sign-in's two reads/writes of this module's table (T143a).
   *
   * A **port** rather than a contribution point (D-39): `autoCreate` decides
   * whether an account may exist at all and then writes one. Both halves are
   * system-scoped because they run *before* a tenant context exists — identity
   * resolution precedes tenancy, exactly as `customerOrgResolver` above.
   *
   * The refusal is the return type rather than a throw: `null` is what
   * `SocialIdentityService` reads as `registration_required`, so the policy
   * lands on the caller as a redirect to the login screen and not as a 500.
   *
   * The setting is `customers.allow_registration_without_organization`, and it
   * is named here even though `customers` owns it. That module already depends
   * on this one, so a port pointing the other way would close a cycle; the
   * platform-wide question "may an account exist without an Organization" is in
   * any case about *this* table.
   */
  ctx.di.providePort(
    'customerSocialLoginPort',
    ctx
      .asFunction(({ emFactory, auditLogService }: CustomerAccountsCradle) => ({
        async resolveByEmail(email: string): Promise<{ id: string } | null> {
          return withSystemScope('mfa: resolve customer by email', async () => {
            // The address arrives from the provider's claim, in whatever case
            // that provider chose to send it; the row is folded, so the compare
            // is too. Unfolded, a returning buyer would be offered registration
            // for an account they already have — and `autoCreate` below would
            // then be refused by the unique index.
            const customer = await emFactory().findOne(CustomerAccount, {
              email: normalizeEmailAddress(email),
              deletedAt: null,
            });
            return customer ? { id: customer.id } : null;
          });
        },

        async autoCreate(email: string): Promise<{ id: string } | null> {
          const cradle = ctx.cradle<CustomerAccountsCradle>();
          // The channel a global-scope read resolves against. Both roots used
          // to pass the literal `'default'` here, which is **not** a channel
          // id: `sales_channel_id` is a uuid column, so the query threw
          // `invalid input syntax for type uuid` on every call, the closure's
          // `catch` read that as "not allowed", and federated sign-in could
          // therefore never create an account in production however the
          // operator had configured it. The harness had no gate at all and
          // always created one. Neither was the behaviour anybody wanted.
          const salesChannelId = await cradle.settingsChannelResolver();
          if (salesChannelId === null) return null;

          let allowed = false;
          try {
            allowed = await cradle.settingsReadPort.get(
              'customers.allow_registration_without_organization',
              salesChannelId,
              z.boolean(),
            );
          } catch {
            // An unregistered or out-of-scope setting denies. Not a bare catch
            // around a module port — `settingsReadPort` is kernel-owned and
            // ungated, so there is no `ModuleDisabledError` to swallow here;
            // the degrade is "no answer means no", which is the safe direction
            // for a gate on account creation.
            allowed = false;
          }
          if (!allowed) return null;

          return withSystemScope('mfa: auto-create customer from social login', async () => {
            const em = emFactory();
            const account = em.create(CustomerAccount, {
              email: normalizeEmailAddress(email),
              // No password was ever chosen for this account: it signs in
              // through the provider. A random one keeps the column non-null
              // without minting a credential anybody could guess — and issue
              // #222 is the other half of that sentence: `passwordSetAt` stays
              // null, so a reader can tell this account from one whose holder
              // really has a password. Do not stamp it here.
              passwordHash: await hashPassword(randomUUID() + randomUUID()),
              passwordSetAt: null,
              firstName: '',
              lastName: '',
              role: 'regular_user',
              organizationId: null,
              emailVerifiedAt: new Date(),
            });
            // The other way an account is created without an admin —
            // `customers`' standalone self-registration — records this same
            // shape with a null actor, and this path did not record anything at
            // all until the coverage scan reached `backend.ts` (issue #122). An
            // account appearing out of a federated sign-in is exactly the event
            // an operator later needs to explain.
            recordAuditFromContext(auditLogService, em, {
              action: 'customer_account.register_social',
              objectType: 'customer_account',
              objectId: account.id,
              stateBefore: null,
              stateAfter: { email: account.email },
            });
            await em.persistAndFlush(account);
            return { id: account.id };
          });
        },
      }))
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 076, D-79 — customer groups.
  //
  // The entity, its service, its read port and its three admin routes moved
  // here from `price_lists`. A customer group describes the customer; a price
  // list refers to one by id. Under the previous owner the single real foreign
  // key into `customer_groups` — `customer_accounts.customer_group_id` — forced
  // this module to declare `price_lists`, which made the reverse declaration a
  // cycle `test/unit/db/module-graph.test.ts` refuses. The key is intra-module now and
  // the class of problem is gone rather than routed around.
  //
  // `customerGroupService` keeps its container name: both composition roots
  // read it for the promotion Rule Builder's target picker, and renaming it
  // would have churned two roots to encode an owner this file already states.
  // ---------------------------------------------------------------------------

  ctx.di.providePort(
    'customerGroupService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CustomerAccountsCradle) =>
          new CustomerGroupService(emFactory, commandBus),
      )
      .singleton(),
  );

  ctx.di.providePort<CustomerGroupReadPort>(
    'customerGroupReadPort',
    ctx
      .asFunction(({ emFactory }: CustomerAccountsCradle) => new CustomerGroupReadService(emFactory))
      .singleton(),
  );

  // The module's only routes. They are the customer-group admin surface and
  // nothing else — customer login, registration and self-service stay with
  // `organizations` and `customers`, which own those screens.
  ctx.routes(async (app) => {
    await registerCustomerGroupAdminRoutes(app, {
      customerGroupService: () => ctx.cradle<CustomerAccountsCradle>().customerGroupService,
      requireAdmin: (permission) => async (req, reply) =>
        ctx.cradle<CustomerAccountsCradle>().requireAdmin(permission)(req, reply),
    });
  });

  /**
   * What an audit row about an impersonated customer is called, and where the admin app shows it
   * (feature 075, D-87 drain).
   *
   * `audit_logs` used to answer both by hand — one SQL statement naming this
   * module's table, and this module's admin route spelled into its own switch.
   * A read port would have been the wrong repair: `audit_logs` is a
   * cross-cutting reader, and five ports into it would be five edges pointing
   * from the record towards the things it records. One of the five contributors
   * (`inventory`) is switchable, and `audit_logs` is `nonDeactivatable`, so that
   * edge would also have taken the operator's switch away. A push costs nothing
   * and reads the same for all five.
   *
   * A **contribution** hook: it pushes an inert resolver into
   * `auditReferenceRegistry`, an ungated registry, and carries no presence probe
   * (D-67/D-68). The registry's own enumeration policy is what drops this entry
   * while the module is absent — probing here would make the drop survive a
   * reactivation until the next restart.
   */
  ctx.onBoot(() => {
    registerCustomerAccountAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      ctx.cradle<CustomerAccountsCradle>().emFactory,
      lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
    );
  });
}
