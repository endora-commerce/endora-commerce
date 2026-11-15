// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  ERROR_CODES,
  FEDERATED_SIGN_IN_COMPLETE_PATH,
  channelUrlLanguages,
  customerFederatedSignInStartQuerySchema,
  federatedSignInExchangeRequestSchema,
  firstLanguageTag,
  scopeLanguageOf,
  storefrontPagePathFor,
} from '@endora-commerce/contracts';
import type {
  AuthSessionPort,
  CartMergeOutcomePublic,
  ChannelUrlFacts,
  CustomerAccountPreferencePort,
  CustomerSignInCompletionPort,
  FederatedSignInErrorCode,
  FederatedSignInExchangeResponse,
  FederatedSignInOptionsResponse,
  MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import type { ChallengeStore, FederatedHandoffInput } from './services/challenge-store.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';
import type { SocialIdentityService, SocialSignInResult } from './services/social-identity-service.js';
import type { CustomerChannelAccess } from './services/customer-channel-access.js';
import type {
  OAuthProviderName,
  OAuthProviderPort,
} from './services/oauth-provider-service.js';

/**
 * Federated sign-in routes (feature 042, US4 customer / US5 admin). Per surface
 * + provider: a `start` endpoint that redirects to the IdP, and a `callback`
 * that validates the transaction, exchanges the code, resolves the account, and
 * then takes the **same second-factor decision the password sign-in takes**.
 *
 * Research note R10 of feature 042 decided the opposite — a provider sign-in
 * issued a session directly, with no TOTP step, to keep that feature's scope
 * bounded and avoid prompting twice; the note itself left the decision open to
 * revisit. It is revisited here: an account holder who enrolled a second factor,
 * or for whom the platform's settings or their organisation enforce one, expects
 * it to apply to every way into the account, and the provider's own sign-in
 * policy is not something this platform can see or require. So a subject with
 * an active enrolment is handed to the second-step screen, and one under an
 * enforced policy without an enrolment is sent back to the password sign-in,
 * which owns the forced-setup flow. Only a subject the decision answers
 * `proceed` for is signed in here.
 *
 * The transaction is also bound to the browser that began it: `start` sets a
 * short-lived httpOnly cookie, scoped to this surface's OAuth path, whose digest
 * is stored with the transaction; `callback` completes only when the same
 * cookie comes back. `SameSite=Lax` is what lets it travel on the provider's
 * redirect back here — a top-level `GET` navigation — while staying off every
 * cross-site sub-request.
 *
 * **The customer callback sets no cookie (issue #1279).** The provider returns
 * to `BACKEND_PUBLIC_URL`, which may be another host than the storefront (the
 * split topology of `deploy/nginx.example.conf`), and a cookie set there would
 * land on the API host, where the storefront never reads it. So the callback
 * takes every decision — binding, provider code, account, channel access, the
 * second factor — and then leaves a single-use hand-off (`ChallengeStore`,
 * sixty seconds) and sends the browser to the started-on channel's storefront,
 * `<origin>/auth/federated/complete?code=…`. The storefront redeems the code
 * server-to-server (`POST /api/v1/auth/customer/oauth/exchange`) and sets its
 * own cookies. The storefront also starts the flow (`/auth/federated/start`):
 * it binds the attempt to the browser with a cookie on its own host and sends
 * this module the digest of that secret, so a code is redeemable only by the
 * browser that began the sign-in. The admin surface is unchanged: the Admin UI
 * calls the API host with credentials, so its session belongs there.
 */
export interface MfaOAuthDeps {
  oauthProvider: OAuthProviderPort;
  challengeStore: ChallengeStore;
  policyResolver: MfaPolicyResolver;
  socialIdentityService: SocialIdentityService;
  /** The second-factor decision the password sign-ins take after the first factor. */
  loginService: Pick<MfaLoginPort, 'beginLogin'>;
  sessionService: AuthSessionPort;
  /** Public base URL of the backend (for the provider redirect_uri). */
  backendBaseUrl: string;
  /** `STOREFRONT_BASE_URL`: the storefront origin when a channel names none. */
  storefrontBaseUrl: string;
  /**
   * Issue #1279 — the storefront origin of a sales channel: its
   * `sales_channels.storefront_url`, else `storefrontBaseUrl`. Operator
   * configuration only, never anything the request carries, so no customer
   * redirect can be pointed elsewhere. Absent: `storefrontBaseUrl` for every
   * channel.
   */
  storefrontOriginFor?: (salesChannelId: string | null) => Promise<string>;
  adminBaseUrl: string;
  /**
   * Feature 154 — the sales-channel access rule for a customer sign-in, asked
   * on the channel the transaction was started on.
   */
  customerChannelAccess: Pick<CustomerChannelAccess, 'permits'>;
  /**
   * Issue #1188 — `organizations`' post-sign-in step (the signed-out basket
   * merged, the anonymous comparison adopted), run once the exchange has
   * created the customer session (issue #1279; it ran in the callback before).
   * A customer handed to the second step is completed by the code screen's
   * verify instead (#368).
   */
  customerSignInCompletion: Pick<CustomerSignInCompletionPort, 'complete'>;
  /**
   * Feature 167 (FR-034) — the URL-language facts of the channel a customer sign-in
   * started on (the system default when none). Absent: storefront paths unprefixed.
   */
  channelUrlFactsFor?: (salesChannelId: string | null) => Promise<ChannelUrlFacts | null>;
  /**
   * Issue #652 (D-292) — `customer_accounts`' preference port: a federated
   * sign-in to an existing account fills its preferred language while it has
   * none. Absent, nothing is captured.
   */
  customerLanguageCapture?: Pick<CustomerAccountPreferencePort, 'captureIfUnset'>;
}

/** The channel language whose path prefix `next` starts with, or null. */
function languageOfPath(next: string, channel: ChannelUrlFacts | null): string | null {
  if (!channel) return null;
  const first = next.split(/[/?#]/)[1]?.toLowerCase() ?? '';
  return channelUrlLanguages(channel).find((l) => l.prefixed && l.prefix === first)?.languageCode ?? null;
}

/**
 * The `error` the storefront's sign-in page maps to its "no access to this
 * store" message (`contracts/storefront-ux.md` §3).
 */
export const SALES_CHANNEL_NOT_PERMITTED_LOGIN_ERROR = 'sales_channel_not_permitted' satisfies FederatedSignInErrorCode;

/**
 * The `error` for a federated sign-in that would have **created** an account on
 * a store closed to anonymous visitors (owner decision D6): refused as
 * individual self-registration is refused there, with nothing created. The
 * storefront maps it to its "signed-in business customers only" sign-in notice.
 */
export const SALES_CHANNEL_SIGN_IN_REQUIRED_LOGIN_ERROR = 'sales_channel_sign_in_required' satisfies FederatedSignInErrorCode;

type Surface = 'customer' | 'admin';

/** The code a refused account resolution is sent back with. */
const SIGN_IN_REFUSAL_CODE: Record<Extract<SocialSignInResult, { ok: false }>['reason'], FederatedSignInErrorCode> = {
  unverified: 'email_unverified',
  no_account: 'no_matching_account',
  blocked: 'account_blocked',
  registration_disabled_in_channel: 'registration_disabled_in_channel',
  sales_channel_sign_in_required: SALES_CHANNEL_SIGN_IN_REQUIRED_LOGIN_ERROR,
};

/**
 * The cookie binding an OAuth transaction to the browser that started it. One
 * name for both surfaces: each is scoped to its own surface's OAuth path, so a
 * request only ever carries the one for the surface it is addressed to.
 */
export const OAUTH_BINDING_COOKIE_NAME = 'b2b_oauth_binding';
/** Seconds; the transaction it binds lives exactly as long. */
const OAUTH_BINDING_MAX_AGE_SECONDS = 10 * 60;

/** Issue #1279 — the storefront's server-to-server redemption of a hand-off code. */
export const FEDERATED_SIGN_IN_EXCHANGE_PATH = '/api/v1/auth/customer/oauth/exchange';

/**
 * The exchange's per-client ceiling, on top of the host's global one. Keyed by
 * `request.ip` — the buyer's where the deployment trusts the storefront as a
 * proxy (`TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES`), since the storefront
 * forwards `x-forwarded-for`; else the storefront's, which is why it is high. A
 * code is 256 random bits and single-use, so the ceiling bounds load, not
 * guessing.
 */
export const FEDERATED_SIGN_IN_EXCHANGE_RATE_LIMIT = {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest): string => `mfa-federated-exchange:${request.ip}`,
};

function oauthCookiePath(surface: Surface): string {
  return `/api/v1/auth/${surface}/oauth`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Whether `secret` is the value `expectedDigest` was taken of, in constant time. */
function matchesDigest(secret: string | undefined, expectedDigest: string | undefined): boolean {
  if (!secret || !expectedDigest) return false;
  const actual = Buffer.from(digest(secret), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Whether the request presents the cookie whose digest the transaction holds. */
function presentsBinding(
  request: { cookies?: Record<string, string | undefined> },
  expectedDigest: string | undefined,
): boolean {
  return matchesDigest(request.cookies?.[OAUTH_BINDING_COOKIE_NAME], expectedDigest);
}

export async function registerMfaOAuthRoutes(
  app: FastifyInstance,
  deps: MfaOAuthDeps,
): Promise<void> {
  for (const surface of ['customer', 'admin'] as const) {
    registerProviders(app, deps, surface);
    registerStart(app, deps, surface);
    registerCallback(app, deps, surface);
  }
  registerExchange(app, deps);
}

/**
 * The frontend a surface's redirects go to: the Admin UI, or — issue #1279 —
 * the storefront of the customer's sales channel.
 */
async function frontendBase(deps: MfaOAuthDeps, surface: Surface, salesChannelId: string | null): Promise<string> {
  if (surface === 'admin') return deps.adminBaseUrl;
  return deps.storefrontOriginFor ? deps.storefrontOriginFor(salesChannelId) : deps.storefrontBaseUrl;
}

function parseProvider(value: string): OAuthProviderName | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function sanitiseNext(input: string | undefined): string {
  if (!input || !input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}

/**
 * The sign-in page a refused attempt is sent back to, carrying the code itself
 * (`federatedSignInErrorCodeSchema`) on both surfaces — a fixed ASCII token, so it
 * needs no encoding. Each frontend words the code in its own copy and reads any
 * other `?error=` value as its generic sign-in failure (issues #789, #813).
 * `base` is the surface's frontend (`frontendBase`): for a customer, the
 * storefront of the channel the sign-in belongs to (issue #1279).
 */
function loginRedirect(
  base: string,
  surface: Surface,
  code: FederatedSignInErrorCode,
  pagePath: (path: string) => string = (path) => path,
): string {
  if (surface === 'customer') return `${base}${pagePath(`/login?error=${code}`)}`;
  return `${base}/login?error=${code}`;
}

/**
 * The providers a login screen may actually offer, for this surface and — for
 * the customer surface — this sales channel.
 *
 * **Pre-auth and public, deliberately.** The login screens are the callers, so
 * there is no actor to gate on; and the answer is exactly what the buttons
 * themselves announce, so it reveals nothing a visitor could not read off the
 * page. It carries no client id, no redirect URI, and nothing per-account —
 * asking it about a particular user is not possible, which is what keeps it
 * from becoming a probe for whether an address has a federated identity.
 *
 * The body is the same conjunction `registerStart` applies below before it will
 * redirect anywhere: the operator's setting for this surface and channel, AND
 * the provider actually being configured. Publishing it stops the frontend from
 * guessing at a decision this module already makes — it used to render both
 * buttons unconditionally, which on a default deployment (both settings
 * `false`) advertised two sign-in routes that could not work (#193).
 *
 * `mfa` owns it, so `ctx.routes` gates it like everything else the module owns:
 * with the module off it answers 503 `MODULE_DISABLED`, and both frontends fail
 * closed on that — no module, no buttons.
 */
function registerProviders(app: FastifyInstance, deps: MfaOAuthDeps, surface: Surface): void {
  // Feature 154 — reachable whatever the sales-channel access rule decides:
  // the sign-in page lists the providers before anybody is signed in.
  app.get(`/api/v1/auth/${surface}/oauth/providers`, { config: { salesChannelAccess: 'open' } }, async (_request, reply) => {
    const salesChannelId = surface === 'customer' ? (currentSalesChannel()?.id ?? null) : null;
    const policy = await deps.policyResolver.resolve(
      { subjectType: surface, subjectId: '' },
      { salesChannelId },
    );
    const providers = (['google', 'microsoft'] as const).filter((provider) => {
      const settingEnabled = provider === 'google' ? policy.googleEnabled : policy.microsoftEnabled;
      return settingEnabled && deps.oauthProvider.isEnabled(provider);
    });
    const body: FederatedSignInOptionsResponse = { providers };
    return reply.send(body);
  });
}

function registerStart(app: FastifyInstance, deps: MfaOAuthDeps, surface: Surface): void {
  app.get<{ Params: { provider: string }; Querystring: { next?: string; salesChannel?: string; binding?: string } }>(
    `/api/v1/auth/${surface}/oauth/:provider/start`,
    // Feature 154 — reachable whatever the sales-channel access rule decides:
    // this is how a visitor of a closed store starts signing in.
    { config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const salesChannelId = surface === 'customer' ? (currentSalesChannel()?.id ?? null) : null;
      const base = await frontendBase(deps, surface, salesChannelId);
      const provider = parseProvider(request.params.provider);
      if (!provider) return reply.redirect(loginRedirect(base, surface, 'unknown_provider'));

      const policy = await deps.policyResolver.resolve(
        { subjectType: surface, subjectId: '' },
        { salesChannelId },
      );
      const settingEnabled = provider === 'google' ? policy.googleEnabled : policy.microsoftEnabled;
      if (!settingEnabled || !deps.oauthProvider.isEnabled(provider)) {
        return reply.redirect(loginRedirect(base, surface, 'provider_unavailable'));
      }

      // Issue #1279 — a customer sign-in is started by the storefront, which
      // binds it to the browser on its own host and sends the digest here. A
      // start without one (an old link, a storefront not yet upgraded) cannot be
      // completed, so it is refused before the provider is involved.
      let storefrontBindingDigest: string | undefined;
      if (surface === 'customer') {
        const query = customerFederatedSignInStartQuerySchema.safeParse(request.query);
        if (!query.success) {
          const parameters = [...new Set(query.error.issues.map((issue) => String(issue.path[0] ?? 'query')))];
          request.log.warn(
            { parameters, salesChannelId },
            `federated sign-in start refused: missing or malformed ${parameters.join(', ')}`,
          );
          return reply.redirect(loginRedirect(base, surface, 'sign_in_failed'));
        }
        storefrontBindingDigest = query.data.binding;
      }

      const next = sanitiseNext(request.query.next);
      // Feature 167 — the starting page's language: the prefix of the `next` the
      // storefront sent (its browser path), else the browser's first language.
      const channelFacts =
        surface === 'customer' && deps.channelUrlFactsFor ? await deps.channelUrlFactsFor(salesChannelId) : null;
      const language =
        surface === 'customer'
          ? (languageOfPath(next, channelFacts) ?? firstLanguageTag(request.headers['accept-language']) ?? null)
          : null;
      const codeVerifier = randomBytes(32).toString('base64url');
      const nonce = randomBytes(16).toString('base64url');
      const binding = randomBytes(32).toString('base64url');
      const state = await deps.challengeStore.issueOAuthTransaction({
        surface,
        provider,
        salesChannelId,
        pkceVerifier: codeVerifier,
        nonce,
        next,
        language,
        browserBinding: digest(binding),
        ...(storefrontBindingDigest ? { storefrontBindingDigest } : {}),
      });
      reply.setCookie(OAUTH_BINDING_COOKIE_NAME, binding, {
        path: oauthCookiePath(surface),
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        maxAge: OAUTH_BINDING_MAX_AGE_SECONDS,
        signed: false,
      });
      const redirectUri = `${deps.backendBaseUrl}/api/v1/auth/${surface}/oauth/${provider}/callback`;
      const url = await deps.oauthProvider.buildAuthorizationUrl(provider, {
        state,
        codeVerifier,
        nonce,
        redirectUri,
      });
      return reply.redirect(url);
    },
  );
}

function registerCallback(app: FastifyInstance, deps: MfaOAuthDeps, surface: Surface): void {
  // Feature 154 — reachable whatever the sales-channel access rule decides: the
  // provider's redirect carries no storefront channel signal.
  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>(`/api/v1/auth/${surface}/oauth/:provider/callback`, { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const provider = parseProvider(request.params.provider);
    const { code, state, error } = request.query;
    // The binding is single-use whatever the outcome: a later attempt starts
    // again and gets a cookie of its own.
    reply.clearCookie(OAUTH_BINDING_COOKIE_NAME, { path: oauthCookiePath(surface) });
    const tx = state ? await deps.challengeStore.getOAuthTransaction(state) : null;
    // Issue #1279 — a customer goes back to the storefront of the channel the
    // transaction was started on, whichever way this ends. The origin comes from
    // the operator's configuration for that channel, never from the request.
    const base = await frontendBase(
      deps,
      surface,
      surface === 'customer' && tx?.surface === surface ? tx.salesChannelId : null,
    );
    if (!provider || error || !code || !state) {
      return reply.redirect(loginRedirect(base, surface, 'sign_in_cancelled'));
    }
    // A callback from a browser that did not start this transaction is refused
    // without consuming it, so it cannot use up the attempt of the one that did.
    // A customer transaction without the storefront's binding (one started
    // before issue #1279) cannot be handed off, so it is refused the same way.
    if (
      !tx ||
      tx.surface !== surface ||
      tx.provider !== provider ||
      !presentsBinding(request, tx.browserBinding) ||
      (surface === 'customer' && !tx.storefrontBindingDigest)
    ) {
      return reply.redirect(loginRedirect(base, surface, 'sign_in_expired'));
    }
    await deps.challengeStore.consumeOAuthTransaction(state);
    // Feature 167 — from here on the transaction is this browser's: the pages it
    // returns to carry the language of the page that started it.
    const channelFacts =
      surface === 'customer' && deps.channelUrlFactsFor ? await deps.channelUrlFactsFor(tx.salesChannelId) : null;
    const pagePath = (path: string): string =>
      storefrontPagePathFor({ path, channel: channelFacts, requestedLanguage: tx.language ?? null });

    const redirectUri = `${deps.backendBaseUrl}/api/v1/auth/${surface}/oauth/${provider}/callback`;
    let identity;
    try {
      identity = await deps.oauthProvider.exchangeCode(provider, {
        code,
        state,
        codeVerifier: tx.pkceVerifier,
        nonce: tx.nonce,
        redirectUri,
      });
    } catch {
      return reply.redirect(loginRedirect(base, surface, 'sign_in_failed', pagePath));
    }

    // Issue #652 (D-292) — the language of the page the sign-in was started on,
    // resolved against that channel: what a new account records, and what an
    // existing one without a language takes below.
    const accountLanguage =
      surface === 'customer' && channelFacts
        ? scopeLanguageOf({ id: tx.salesChannelId ?? '', ...channelFacts }, tx.language ?? null)
        : null;

    const result =
      surface === 'customer'
        ? await deps.socialIdentityService.signInCustomer(identity, {
            salesChannelId: tx.salesChannelId,
            preferredLanguage: accountLanguage,
          })
        : await deps.socialIdentityService.signInAdmin(identity);

    if (!result.ok) {
      return reply.redirect(loginRedirect(base, surface, SIGN_IN_REFUSAL_CODE[result.reason], pagePath));
    }

    // Feature 154 — a customer signs in only on a sales channel its
    // Organization is assigned to: the channel the transaction was started on,
    // because the provider's redirect carries no storefront channel. Decided
    // before a second factor is started or a session issued, as the password
    // sign-in decides it.
    if (
      surface === 'customer' &&
      !(await deps.customerChannelAccess.permits(result.organizationId, tx.salesChannelId))
    ) {
      return reply.redirect(
        loginRedirect(base, surface, SALES_CHANNEL_NOT_PERMITTED_LOGIN_ERROR, pagePath),
      );
    }

    // Issue #652 (D-292) — an accepted customer sign-in fills an unknown
    // preferred language, before the second factor as the password sign-in
    // does; a known one is left alone by the port. Best effort: a failed
    // capture is logged by account id — never the tag — and the sign-in goes on.
    if (surface === 'customer' && accountLanguage && deps.customerLanguageCapture) {
      try {
        await deps.customerLanguageCapture.captureIfUnset(result.subjectId, accountLanguage);
      } catch (err) {
        request.log.warn(
          { err, customerAccountId: result.subjectId },
          'mfa: preferred-language capture at federated sign-in failed',
        );
      }
    }

    // The second factor, decided exactly as the password sign-ins decide it.
    // No session is issued here unless the answer is `proceed`.
    const decision = await deps.loginService.beginLogin(
      { subjectType: surface, subjectId: result.subjectId },
      {
        salesChannelId: surface === 'customer' ? tx.salesChannelId : null,
        organizationId: surface === 'customer' ? result.organizationId : null,
      },
    );
    if (decision.kind === 'setup') {
      return reply.redirect(loginRedirect(base, surface, 'mfa_setup_required', pagePath));
    }

    if (surface === 'customer') {
      // Issue #1279 — no cookie here: the storefront redeems the hand-off and
      // sets the session (or the second-step challenge) on its own host.
      const common = {
        customerAccountId: result.subjectId,
        salesChannelId: tx.salesChannelId,
        storefrontBindingDigest: tx.storefrontBindingDigest!,
      };
      const handoff: FederatedHandoffInput =
        decision.kind === 'challenge'
          ? {
              ...common,
              kind: 'mfaChallenge',
              challengeId: decision.challengeId,
              redirectPath: pagePath(`/login/mfa?next=${encodeURIComponent(sanitiseNext(tx.next))}`),
            }
          : {
              ...common,
              kind: 'session',
              organizationId: result.organizationId,
              redirectPath: sanitiseNext(tx.next),
            };
      const issued = await deps.challengeStore.issueFederatedHandoff(handoff);
      request.log.info(
        {
          outcome: 'handoff_issued',
          kind: handoff.kind,
          codeDigestPrefix: issued.codeDigest.slice(0, 8),
          salesChannelId: tx.salesChannelId,
        },
        'federated sign-in hand-off issued',
      );
      // The landing URL carries the code: it must not leak to whatever the
      // storefront page loads next, nor be sent on by this redirect.
      reply.header('Referrer-Policy', 'no-referrer');
      return reply.redirect(`${base}${FEDERATED_SIGN_IN_COMPLETE_PATH}?code=${encodeURIComponent(issued.code)}`);
    }

    if (decision.kind === 'challenge') {
      // The Admin UI holds the pending challenge in memory, as after its own
      // password step. The fragment is how it gets there: a fragment is never
      // sent to a server or in a `Referer`, and the Admin UI removes it from
      // the address bar as soon as it has read it.
      return reply.redirect(
        `${deps.adminBaseUrl}/#mfa-challenge=${encodeURIComponent(decision.challengeId)}`,
      );
    }

    const session = await deps.sessionService.createSession({
      kind: 'admin',
      adminUserId: result.subjectId,
      ...ipUa(request),
    });
    setSessionCookie(reply, ADMIN_SESSION_COOKIE_NAME, session.cookieValue, session.expiresAt);
    return reply.redirect(`${deps.adminBaseUrl}/`);
  });
}

/**
 * Issue #1279 — `POST /api/v1/auth/customer/oauth/exchange`: the storefront's
 * server-to-server redemption of the code the callback left, answered like the
 * password sign-in (`federatedSignInExchangeResponseSchema`).
 *
 * The storefront calls it from its landing route with the browser's own
 * storefront cookies it forwards for every sign-in (`b2b_cart_anon`,
 * `compare_token`, the known-device cookie), `X-Sales-Channel`,
 * `x-forwarded-for` and `user-agent`. So this is where the session is created
 * and where the signed-out basket is carried over (#1188): on split hosts the
 * provider's redirect to the API host never carries the storefront's basket.
 *
 * The code is taken out of the store before anything is checked, so a refused
 * attempt has used it up as well — a binding guessed wrong cannot be retried.
 * Every refusal is the same `400 MFA_FEDERATED_HANDOFF_INVALID`; which check
 * refused is logged, never answered. Nothing secret is logged: not the code, not
 * the binding, not the challenge or the session — only the first eight hex
 * digits of the code's digest.
 */
function registerExchange(app: FastifyInstance, deps: MfaOAuthDeps): void {
  // Declared as a value rather than an inline literal: `rateLimit` is an
  // augmentation of `@fastify/rate-limit`, which the host registers and this
  // package does not depend on.
  const exchangeConfig = {
    // Feature 154 — the exchange completes a sign-in before any session exists;
    // the channel it must be asked on is checked against the hand-off below.
    salesChannelAccess: 'open' as const,
    rateLimit: FEDERATED_SIGN_IN_EXCHANGE_RATE_LIMIT,
  };
  app.post(
    FEDERATED_SIGN_IN_EXCHANGE_PATH,
    { schema: { body: federatedSignInExchangeRequestSchema }, config: exchangeConfig },
    async (request, reply): Promise<FederatedSignInExchangeResponse> => {
      const body = federatedSignInExchangeRequestSchema.parse(request.body);
      const codeDigestPrefix = digest(body.code).slice(0, 8);
      const handoff = await deps.challengeStore.takeFederatedHandoff(body.code);
      const refuse = (reason: string): never => {
        request.log.warn(
          { outcome: 'refused', reason, codeDigestPrefix, salesChannelId: handoff?.salesChannelId ?? null },
          'federated sign-in hand-off refused',
        );
        throw new HttpError(
          400,
          ERROR_CODES.MFA_FEDERATED_HANDOFF_INVALID,
          'This sign-in has expired or was already used. Please sign in again.',
        );
      };
      if (!handoff) return refuse('unknown_expired_or_used');
      if (!matchesDigest(body.binding, handoff.storefrontBindingDigest)) return refuse('binding_mismatch');
      if ((currentSalesChannel()?.id ?? null) !== handoff.salesChannelId) return refuse('sales_channel_mismatch');
      if (
        !(await deps.challengeStore.isCurrentGeneration('customer', handoff.customerAccountId, handoff.generation))
      ) {
        return refuse('withdrawn');
      }

      const logRedeemed = (): void =>
        request.log.info(
          { outcome: 'redeemed', kind: handoff.kind, codeDigestPrefix, salesChannelId: handoff.salesChannelId },
          'federated sign-in hand-off redeemed',
        );
      if (handoff.kind === 'mfaChallenge') {
        logRedeemed();
        return {
          data: { status: 'mfaRequired', challengeId: handoff.challengeId, redirectPath: handoff.redirectPath },
        };
      }

      const session = await deps.sessionService.createSession({
        kind: 'customer',
        customerAccountId: handoff.customerAccountId,
        ...ipUa(request),
      });
      setSessionCookie(reply, SESSION_COOKIE_NAME, session.cookieValue, session.expiresAt);
      const cartMerge = await completeCustomerSignIn(
        deps,
        request,
        reply,
        handoff.customerAccountId,
        handoff.salesChannelId,
      );
      logRedeemed();
      return { data: { status: 'authenticated', redirectPath: handoff.redirectPath, cartMerge } };
    },
  );
}

/**
 * Issue #1188 — the customer session has just been set on this response, so run
 * the post-sign-in step every customer sign-in runs, over the cookies the
 * storefront forwarded and on the channel the sign-in was started on.
 *
 * Issue #1279 — this runs in the exchange, whose cookies are the storefront
 * host's: the provider's redirect to the API host never carries them on split
 * hosts. The drained anonymous cookie is cleared on this response, as the
 * second step's verify clears it; the merge notice is the storefront's to
 * write from the returned `cartMerge`, as after a password sign-in. The step
 * does not throw for a failed merge, so nothing here catches.
 */
async function completeCustomerSignIn(
  deps: MfaOAuthDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  customerAccountId: string,
  salesChannelId: string | null,
): Promise<CartMergeOutcomePublic | null> {
  const completion = await deps.customerSignInCompletion.complete({
    customerAccountId,
    cookies: request.cookies ?? {},
    salesChannelId,
    log: request.log,
  });
  if (completion.clearAnonymousCartCookie) {
    reply.clearCookie(ANON_CART_COOKIE_NAME, { path: '/' });
  }
  return completion.cartMerge;
}

/** The signed-out basket's cookie, as `carts` sets it and the storefront forwards it. */
const ANON_CART_COOKIE_NAME = 'b2b_cart_anon';

function ipUa(request: { ip?: string; headers: Record<string, unknown> }): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(typeof request.headers['user-agent'] === 'string'
      ? { userAgent: request.headers['user-agent'] as string }
      : {}),
  };
}

function setSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  value: string,
  expiresAt: Date,
): void {
  reply.setCookie(cookieName, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}
