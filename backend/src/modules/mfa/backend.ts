import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import type { SettingsReader } from './services/mfa-policy-resolver.js';
import type { OAuthProviderPort } from './services/oauth-provider-service.js';
import type { SocialIdentityDeps } from './services/social-identity-service.js';
import { mfaModule, type MfaModuleHandle } from './plugin.js';

/**
 * `mfa` — the widest option surface in the wave, and why it is four names
 * rather than fifteen (feature 072, wave 1, T096).
 *
 * `MfaModuleOptions` had twenty-four fields. Most are not dependencies in any
 * interesting sense: they are the *shape a composition gives an actor*, and the
 * two roots genuinely disagree about it — production reads `request.actor`
 * while the harness reads `request.testActor`. Turning each into its own
 * contribution point would have produced ten names that are always contributed
 * together, always by the same caller, and always meaningless apart.
 *
 * So the five actor- and account-shaped closures are **one** contribution:
 * {@link MfaActorBridge}. A composition either knows how to turn a request into
 * an actor and an account id into an email, or it does not; there is no
 * coherent state where it knows three of the five. Grouping them also makes the
 * default honest — a bridge that throws, rather than five independently
 * omissible functions each defaulting to something plausible. This wave has
 * removed that second shape seven times.
 *
 * The remaining three names are genuinely independent:
 *
 *  - `mfaOauthProvider` — absent on a deployment with no social sign-in.
 *  - `mfaSocialAccountResolvers` — same, and separately omissible because a
 *    deployment can carry the provider without standalone registration.
 *  - `mfaDefaultChannelIdResolver` — defaults to `async () => null`, which is
 *    exactly the `?? null` both roots already spell at the call site.
 *
 * `requireCustomer` is resolved rather than passed, but it is **not** this
 * module's to own: it is `auth`'s customer-side guard, still declared inline in
 * `composition.ts` while the harness runs a separate `requireTestCustomer()`.
 * That is the divergence T011/T012 already fixed for `requireAdmin` and never
 * did for this one; it is filed as its own task rather than folded in here,
 * because unifying it touches twenty-seven call sites that have nothing to do
 * with MFA.
 *
 * The base URLs come from the environment, read here rather than threaded from
 * a root — a packaged module reads its own configuration.
 */

/**
 * How a composition turns requests into actors and account ids into accounts.
 *
 * Contributed whole, by the composition root, because the root is the only
 * place that knows the answer: production authenticates through `request.actor`
 * and the harness through `request.testActor`.
 */
export interface MfaActorBridge {
  resolveCustomerActor(request: FastifyRequest): {
    customerAccountId: string;
    organizationId: string | null;
  };
  resolveAdminActor(request: FastifyRequest): { adminUserId: string };
  resolveOrgAdmin(request: FastifyRequest): Promise<{ organizationId: string; actor: string }>;
  resolveOrganizationCustomerIds(organizationId: string): Promise<string[]>;
  /**
   * Turns an account id into an address for the notification MFA sends on
   * enrolment changes. Optional: absent, the routes fall back to the subject
   * id, which is a worse label and nothing more.
   */
  resolveAccountEmail?(
    subjectType: 'customer' | 'admin',
    subjectId: string,
  ): Promise<string | null>;
  /**
   * Optional, and its absence is **more** restrictive rather than less — which
   * is why it is the one thing on this interface allowed to be omitted without
   * argument. `reauthenticate` accepts either a current second factor or the
   * account password before letting someone disable 2FA; with no verifier the
   * password branch is simply unreachable and a code becomes mandatory. A
   * composition that cannot check passwords therefore fails closed.
   */
  verifyAccountPassword?(
    subjectType: 'customer' | 'admin',
    subjectId: string,
    password: string,
  ): Promise<boolean>;
}

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
  readonly auditLogService: AuditLogService;
  readonly sessionService: SessionService;
  readonly settingsReadPort: SettingsReader;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (request: FastifyRequest) => Promise<void>;
  readonly mfaActorBridge: MfaActorBridge;
  readonly mfaOauthProvider: OAuthProviderPort | undefined;
  readonly mfaSocialAccountResolvers: SocialIdentityDeps | undefined;
  readonly mfaDefaultChannelIdResolver: () => Promise<string | null>;
  readonly mfaBaseUrls: MfaBaseUrls;
  readonly mfa: { handle: () => MfaModuleHandle; plugin: unknown };
  readonly mfaLoginPort: MfaLoginPort;
}

/**
 * The default bridge: refuses, loudly, naming what is missing.
 *
 * Deliberately not a set of permissive stubs. Every function here sits on an
 * authentication path, and the failure mode of a plausible default on an
 * authentication path is an account that can be reached without the factor it
 * was supposed to require.
 */
function unbridged(): never {
  throw new HttpError(
    500,
    ERROR_CODES.INTERNAL,
    'MFA is composed without an actor bridge: this composition registered no `mfaActorBridge`.',
  );
}

const REFUSING_BRIDGE: MfaActorBridge = {
  resolveCustomerActor: unbridged,
  resolveAdminActor: unbridged,
  resolveOrgAdmin: unbridged,
  resolveOrganizationCustomerIds: unbridged,
};

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    mfaActorBridge: ctx.asFunction((): MfaActorBridge => REFUSING_BRIDGE).singleton(),
    mfaOauthProvider: ctx.asFunction((): OAuthProviderPort | undefined => undefined).singleton(),
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
        ({ emFactory, redis, auditLogService, sessionService }: MfaCradle) => {
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
          const bridge = (): MfaActorBridge => ctx.cradle<MfaCradle>().mfaActorBridge;
          const { mfaOauthProvider: oauthProvider, mfaSocialAccountResolvers: socialAccountResolvers } =
            ctx.cradle<MfaCradle>();
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
            sessionService,
            resolveDefaultChannelId: () => ctx.cradle<MfaCradle>().mfaDefaultChannelIdResolver(),
            ...(secretEncryptionKey === undefined ? {} : { secretEncryptionKey }),
            ...(backendBaseUrl === undefined ? {} : { backendBaseUrl }),
            ...(storefrontBaseUrl === undefined ? {} : { storefrontBaseUrl }),
            ...(adminBaseUrl === undefined ? {} : { adminBaseUrl }),
            requireCustomer: (request) => ctx.cradle<MfaCradle>().requireCustomer(request),
            requireAdmin: (permission) => async (req, reply) =>
              ctx.cradle<MfaCradle>().requireAdmin(permission)(req, reply),
            resolveCustomerActor: (request) => bridge().resolveCustomerActor(request),
            resolveAdminActor: (request) => bridge().resolveAdminActor(request),
            resolveOrgAdmin: (request) => bridge().resolveOrgAdmin(request),
            resolveOrganizationCustomerIds: (organizationId) =>
              bridge().resolveOrganizationCustomerIds(organizationId),
            // Forwarded only when the bridge carries them, so the module keeps
            // seeing "absent" rather than "present and returning nothing" —
            // `exactOptionalPropertyTypes` makes that a real distinction, and
            // for the password verifier it is the difference between requiring
            // a second factor and accepting a password that never verifies.
            ...(bridge().resolveAccountEmail === undefined
              ? {}
              : {
                  resolveAccountEmail: (
                    subjectType: 'customer' | 'admin',
                    subjectId: string,
                  ) => bridge().resolveAccountEmail!(subjectType, subjectId),
                }),
            ...(bridge().verifyAccountPassword === undefined
              ? {}
              : {
                  verifyAccountPassword: (
                    subjectType: 'customer' | 'admin',
                    subjectId: string,
                    password: string,
                  ) => bridge().verifyAccountPassword!(subjectType, subjectId, password),
                }),
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

  ctx.routes(async (app) => {
    const plugin = ctx.cradle<MfaCradle>().mfa.plugin as (a: typeof app) => Promise<void>;
    await plugin(app);
  });
}
