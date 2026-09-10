import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type {
  AdminPasswordVerificationPort,
  AdminUserReadPort,
  AuthSessionPort,
  CustomerAccountReadPort,
  CustomerPasswordStatePort,
  CustomerPasswordVerificationPort,
  MfaEnrolmentCountPort,
  MfaEnrolmentStatePort,
  MfaLoginPort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SettingsReader } from './services/mfa-policy-resolver.js';
import {
  OpenIdOAuthProvider,
  readOAuthConfigFromEnv,
  type OAuthProviderPort,
} from './services/oauth-provider-service.js';
import {
  createAccountEmailResolver,
  createAccountPasswordVerifier,
  createOrganizationAdminResolver,
  createOrganizationCustomerIdsResolver,
} from './services/account-identity.js';
import { MfaEnrolmentCountService } from './services/mfa-enrolment-count.service.js';
import { MfaEnrolmentStateService } from './services/mfa-enrolment-state.service.js';
import type { SocialIdentityDeps } from './services/social-identity-service.js';
import { mfaModule, type MfaModuleHandle } from './plugin.js';
import { MfaEnrolment } from './entities/mfa-enrolment.entity.js';
import { MfaOrganizationPolicy } from './entities/mfa-organization-policy.entity.js';
import { MfaRecoveryCode } from './entities/mfa-recovery-code.entity.js';
import { MfaSocialIdentity } from './entities/mfa-social-identity.entity.js';

/**
 * `mfa` — the widest option surface in the wave, and why it is three names
 * rather than fifteen (feature 072, wave 1, T096;
 * `specs/110-instance-repository/` T118c).
 *
 * `MfaModuleOptions` had twenty-four fields. Wave 1 grouped six of them into a
 * single `MfaActorBridge` contribution on the reasoning that they were the
 * *shape a composition gives an actor* and that the two roots genuinely
 * disagreed about it — production reading `request.actor`, the harness
 * `request.testActor`. **T118c re-derived the six and the premise held for none
 * of them.**
 *
 *  - `resolveCustomerActor` was a duplicate spelling of `customerActorResolver`,
 *    byte-identical to the platform's contribution in production and to the
 *    harness's in the harness. One question, two answers, agreeing by hand.
 *  - `resolveAdminActor` was `adminContextResolver` plus a `promoteAdminActor`
 *    call that every one of its call sites had already made: each sits behind
 *    `requireAdmin`, whose `auth` implementation promotes and then refuses a
 *    non-admin, so the bridge re-asked a question its own guard had answered.
 *  - `resolveOrgAdmin` was the actor resolver plus one
 *    `customerAccountReadPort.findById` and a role check.
 *  - `resolveOrganizationCustomerIds`, `resolveAccountEmail` and
 *    `verifyAccountPassword` were four identity ports and nothing else.
 *
 * So the module resolves them itself now: two contributed actor names it reads
 * off the cradle like the eight other modules that read them, and four
 * `lazyPort` reads over `admin_users`' and `customer_accounts`' published
 * contracts — both already in this module's manifest `dependencies`, both
 * `nonDeactivatable`, so no operator loses a control to the edge.
 *
 * **Two of the six were asserted by nothing**, which is what a bridge with an
 * optional half buys: the harness omitted `resolveAccountEmail` and
 * `verifyAccountPassword` and production supplied them, so under test an
 * authenticator entry was labelled with a UUID instead of an e-mail address and
 * the password branch of `reauthenticate` did not exist. Neither difference was
 * reachable by any test in the tree. They are not optional any more — the
 * module always answers — and `backend/test/integration/mfa/account-identity-wiring.test.ts`
 * is where both are now asserted.
 *
 * The remaining three names are genuinely independent:
 *
 *  - `mfaOauthProvider` — absent on a deployment with no social sign-in.
 *  - `mfaSocialAccountResolvers` — same, and separately omissible because a
 *    deployment can carry the provider without standalone registration.
 *  - `mfaDefaultChannelIdResolver` — defaults to `async () => null`, which is
 *    exactly the `?? null` both roots already spell at the call site.
 *
 * `requireCustomer` is resolved rather than passed, and it is **not** this
 * module's to own: it is `auth`'s customer-side guard, which `auth` provides as
 * a port beside `requireAdmin` since issue #43. Until then each root declared
 * its own — `composition.ts` inline, the harness as `requireTestCustomer()` —
 * and the two disagreed on which request property carried the actor. Unifying
 * them was filed as its own task rather than folded in here, because it touched
 * twenty-seven call sites that have nothing to do with MFA.
 *
 * The base URLs come from the environment, read here rather than threaded from
 * a root — a packaged module reads its own configuration.
 */

/**
 * The origins MFA stamps into the links it sends and the OAuth redirects it
 * builds. Defaults to the environment, because a packaged module reads its own
 * configuration; contributed by a composition that has its own answer.
 */
export interface MfaBaseUrls {
  readonly backend: string | undefined;
  readonly storefront: string | undefined;
  readonly admin: string | undefined;
}

export interface MfaCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  readonly auditLogService: AuditPort;
  readonly commandBus: CommandBus;
  readonly authSessionPort: AuthSessionPort;
  readonly settingsReadPort: SettingsReader;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (request: FastifyRequest) => Promise<void>;
  /**
   * T118c — the two actor names the composition already contributes for every
   * other module that asks who is calling. Declared structurally, as the eight
   * other consumers declare them, so this module names no composition root.
   */
  readonly customerActorResolver: (request: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string | null;
  };
  readonly adminContextResolver: (request: FastifyRequest) => { adminUserId: string };
  readonly mfaOauthProvider: OAuthProviderPort | undefined;
  readonly mfaSocialAccountResolvers: SocialIdentityDeps | undefined;
  readonly mfaDefaultChannelIdResolver: () => Promise<string | null>;
  readonly mfaBaseUrls: MfaBaseUrls;
  readonly mfa: { handle: () => MfaModuleHandle; plugin: unknown };
  readonly mfaLoginPort: MfaLoginPort;
  readonly mfaEnrolmentCountPort: MfaEnrolmentCountPort;
  readonly mfaEnrolmentStatePort: MfaEnrolmentStatePort;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * Federated sign-in, defaulted to whatever this deployment's environment
     * configures (T143c).
     *
     * It used to default to `undefined` and be contributed by a root, which
     * meant `composition.ts` imported this module's provider class and its env
     * reader to decide, on the module's behalf, whether the module had social
     * sign-in — the shape the composition checklist rules out for a knob the
     * module can read itself. `MFA_OAUTH_*` is this module's configuration and
     * nothing else reads it.
     *
     * The seam it leaves is the one `organizations`' VAT clients left in T138 /
     * T140: production takes the real `openid-client` provider by default, the
     * test harness contributes a deterministic fake over the same name, and
     * neither root names the class. `undefined` still means "no social sign-in
     * on this deployment", which is what an unconfigured environment produces.
     */
    mfaOauthProvider: ctx
      .asFunction((): OAuthProviderPort | undefined => {
        const config = readOAuthConfigFromEnv();
        return config.google || config.microsoft ? new OpenIdOAuthProvider(config) : undefined;
      })
      .singleton(),
    mfaSocialAccountResolvers: ctx
      .asFunction((): SocialIdentityDeps | undefined => undefined)
      .singleton(),
    // `null` means "no system-default sales channel", which is what both roots
    // already fall back to when the resolver finds none.
    mfaDefaultChannelIdResolver: ctx
      .asFunction(() => async (): Promise<string | null> => null)
      .singleton(),
    mfaBaseUrls: ctx
      .asFunction(
        (): MfaBaseUrls => ({
          backend: process.env['BACKEND_PUBLIC_URL'],
          storefront: process.env['STOREFRONT_BASE_URL'],
          admin: process.env['ADMIN_BASE_URL'],
        }),
      )
      .singleton(),

    mfa: ctx
      .asFunction(
        ({ emFactory, redis, auditLogService, commandBus }: MfaCradle) => {
          const secretEncryptionKey = process.env['MFA_SECRET_ENCRYPTION_KEY'];
          const {
            backend: backendBaseUrl,
            storefront: storefrontBaseUrl,
            admin: adminBaseUrl,
          } = ctx.cradle<MfaCradle>().mfaBaseUrls;
          // Every cross-composition input below is read from the cradle at call
          // time. Capturing them would freeze this module's view of the
          // composition at the instant it happens to be constructed, which for
          // a guard means it keeps admitting requests after `auth` goes away.
          const { mfaOauthProvider: oauthProvider, mfaSocialAccountResolvers: socialAccountResolvers } =
            ctx.cradle<MfaCradle>();
          // T118c — the four identity ports the retired bridge's members were
          // built out of. `lazyPort` proxies, never resolved values: a captured
          // gate keeps answering after its owner is switched off, and on an
          // authentication path that is an account reachable without the factor
          // it was supposed to require.
          const customerAccounts = lazyPort<CustomerAccountReadPort>(
            ctx,
            'customerAccountReadPort',
          );
          const adminUsers = lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort');
          const resolveOrganizationAdmin = createOrganizationAdminResolver(customerAccounts);
          return mfaModule({
            emFactory,
            redis,
            // Deferred rather than destructured: both roots read `mfaLoginPort`
            // to contribute the getter `customer_accounts` needs at login, and
            // that read happens *before* either registers `settingsReadPort`.
            // Taking it as a constructor argument would resolve this module at
            // that moment and fail on a name that does not exist yet.
            settingsService: {
              get: (code, salesChannelId, schema) =>
                ctx.cradle<MfaCradle>().settingsReadPort.get(code, salesChannelId, schema),
            },
            auditLogService,
            commandBus,
            // Issue #222 — `customer_accounts`' published answer to "does this
            // account have a password on record". Resolved lazily like the
            // session port beside it: a captured gate would keep answering
            // after its owner went away, and this one decides whether somebody
            // may remove their last way into their account.
            customerPasswordState: lazyPort<CustomerPasswordStatePort>(
              ctx,
              'customerPasswordStatePort',
            ),
            // Feature 075 Phase C — `auth`'s published session surface, not its
            // `SessionService` class. The two fields the second factor reads
            // (the cookie value and its expiry) travel as plain data; the
            // `Session` entity stays behind the boundary, where its `tokenHash`
            // belongs.
            sessionService: lazyPort<AuthSessionPort>(ctx, 'authSessionPort'),
            resolveDefaultChannelId: () => ctx.cradle<MfaCradle>().mfaDefaultChannelIdResolver(),
            ...(secretEncryptionKey === undefined ? {} : { secretEncryptionKey }),
            ...(backendBaseUrl === undefined ? {} : { backendBaseUrl }),
            ...(storefrontBaseUrl === undefined ? {} : { storefrontBaseUrl }),
            ...(adminBaseUrl === undefined ? {} : { adminBaseUrl }),
            requireCustomer: (request) => ctx.cradle<MfaCradle>().requireCustomer(request),
            requireAdmin: (permission) => async (req, reply) =>
              ctx.cradle<MfaCradle>().requireAdmin(permission)(req, reply),
            // T118c — read from the cradle at call time for the reason every
            // other input here is: the composition's answer to "who is asking",
            // not a second copy of it written in this module.
            resolveCustomerActor: (request) =>
              ctx.cradle<MfaCradle>().customerActorResolver(request),
            // `adminContextResolver`, and no `promoteAdminActor` beside it:
            // every call site is behind `requireAdmin`, whose `auth`
            // implementation promotes and then refuses a non-admin, so the
            // promotion has happened before this runs.
            resolveAdminActor: (request) =>
              ctx.cradle<MfaCradle>().adminContextResolver(request),
            resolveOrgAdmin: (request) =>
              resolveOrganizationAdmin(
                ctx.cradle<MfaCradle>().customerActorResolver(request).customerAccountId,
              ),
            resolveOrganizationCustomerIds:
              createOrganizationCustomerIdsResolver(customerAccounts),
            resolveAccountEmail: createAccountEmailResolver(customerAccounts, adminUsers),
            verifyAccountPassword: createAccountPasswordVerifier(
              lazyPort<CustomerPasswordVerificationPort>(
                ctx,
                'customerPasswordVerificationPort',
              ),
              lazyPort<AdminPasswordVerificationPort>(ctx, 'adminPasswordVerificationPort'),
            ),
            // Spread rather than assigned: `exactOptionalPropertyTypes` makes
            // "absent" and "present as undefined" different types, and these
            // two are genuinely absent on a deployment without social sign-in.
            ...(oauthProvider === undefined ? {} : { oauthProvider }),
            ...(socialAccountResolvers === undefined ? {} : { socialAccountResolvers }),
          });
        },
      )
      .singleton(),
  });

  ctx.di.providePort(
    'mfaLoginPort',
    ctx.asFunction(({ mfa }: MfaCradle) => mfa.handle().mfaLoginPort).singleton(),
  );

  /**
   * The live half of the deactivation-confirmation dialog (owner ruling on
   * D-96.5): how many people currently hold a second factor.
   *
   * Gated like every other port, and that is exactly right here — the dialog
   * renders *before* the flip, while this module is still on, so the question
   * is asked through an open gate. `/platform/modules` decides presence before
   * it resolves this and renders "unavailable" rather than blocking the flip if
   * the read fails.
   */
  ctx.di.providePort<MfaEnrolmentCountPort>(
    'mfaEnrolmentCountPort',
    ctx
      .asFunction(({ emFactory }: MfaCradle) => new MfaEnrolmentCountService(emFactory))
      .singleton(),
  );

  /**
   * Who holds a second factor, for the two identity modules that publish
   * `twoFactorEnabled`.
   *
   * Gated like every other port, and unlike `mfaEnrolmentCountPort` above it is
   * read on ordinary request paths rather than in a dialog that precedes the
   * flip — so both consumers ask `effectiveState.isPresent('mfa')` before they
   * resolve it and report `false` when this module is absent. That is a
   * declared degrade, not a caught gate: with `mfa` off nothing asks for a
   * second factor at sign-in, so no account is protected by one and `false` is
   * the answer rather than a substitute for one.
   */
  ctx.di.providePort<MfaEnrolmentStatePort>(
    'mfaEnrolmentStatePort',
    ctx
      .asFunction(({ emFactory }: MfaCradle) => new MfaEnrolmentStateService(emFactory))
      .singleton(),
  );

  ctx.routes(async (app) => {
    const plugin = ctx.cradle<MfaCradle>().mfa.plugin as (a: typeof app) => Promise<void>;
    await plugin(app);
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  MfaEnrolment,
  MfaOrganizationPolicy,
  MfaRecoveryCode,
  MfaSocialIdentity,
];
