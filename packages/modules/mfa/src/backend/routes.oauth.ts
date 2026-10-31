// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
  MFA_CHALLENGE_COOKIE_NAME,
  channelUrlLanguages,
  firstLanguageTag,
  storefrontPagePathFor,
} from '@endora-commerce/contracts';
import type {
  AuthSessionPort,
  ChannelUrlFacts,
  FederatedSignInOptionsResponse,
  MfaLoginPort,
} from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import type { ChallengeStore } from './services/challenge-store.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';
import type { SocialIdentityService } from './services/social-identity-service.js';
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
  storefrontBaseUrl: string;
  adminBaseUrl: string;
  /**
   * Feature 154 — the sales-channel access rule for a customer sign-in, asked
   * on the channel the transaction was started on.
   */
  customerChannelAccess: Pick<CustomerChannelAccess, 'permits'>;
  /**
   * Feature 167 (FR-034) — the URL-language facts of the channel a customer sign-in
   * started on (the system default when none). Absent: storefront paths unprefixed.
   */
  channelUrlFactsFor?: (salesChannelId: string | null) => Promise<ChannelUrlFacts | null>;
}

/** The channel language whose path prefix `next` starts with, or null. */
function languageOfPath(next: string, channel: ChannelUrlFacts | null): string | null {
  if (!channel) return null;
  const first = next.split(/[/?#]/)[1]?.toLowerCase() ?? '';
  return channelUrlLanguages(channel).find((l) => l.prefixed && l.prefix === first)?.languageCode ?? null;
}

/**
 * The `error` the storefront's sign-in page maps to its "no access to this
 * store" message (`contracts/storefront-ux.md` §3). A code, not a sentence: the
 * storefront owns the wording in both of its languages.
 */
export const SALES_CHANNEL_NOT_PERMITTED_LOGIN_ERROR = 'sales_channel_not_permitted';

/**
 * The `error` for a federated sign-in that would have **created** an account on
 * a store closed to anonymous visitors (owner decision D6): refused as
 * individual self-registration is refused there, with nothing created. The
 * storefront maps it to its "signed-in business customers only" sign-in notice.
 */
export const SALES_CHANNEL_SIGN_IN_REQUIRED_LOGIN_ERROR = 'sales_channel_sign_in_required';

type Surface = 'customer' | 'admin';

/**
 * The cookie binding an OAuth transaction to the browser that started it. One
 * name for both surfaces: each is scoped to its own surface's OAuth path, so a
 * request only ever carries the one for the surface it is addressed to.
 */
export const OAUTH_BINDING_COOKIE_NAME = 'b2b_oauth_binding';
/** Seconds; the transaction it binds lives exactly as long. */
const OAUTH_BINDING_MAX_AGE_SECONDS = 10 * 60;
/** Seconds; the pending second-step challenge lives exactly as long. */
const MFA_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

/** The sentence the password sign-in answers a blocked customer account with. */
const ACCOUNT_BLOCKED_MESSAGE = 'This account has been blocked. Please contact support.';

/**
 * An enforced second factor that is not set up yet. The administrator's
 * sentence is the one the Admin UI shows after a password step; a customer is
 * pointed at the password sign-in, which is where the storefront's forced setup
 * begins.
 */
const SETUP_REQUIRED_MESSAGE: Record<Surface, string> = {
  customer:
    'Two-step verification is required for your account. Sign in with your email and password to set it up.',
  admin:
    'Two-step verification is required for your account. Please contact a platform administrator to finish setup.',
};

function oauthCookiePath(surface: Surface): string {
  return `/api/v1/auth/${surface}/oauth`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Whether the request presents the cookie whose digest the transaction holds. */
function presentsBinding(
  request: { cookies?: Record<string, string | undefined> },
  expectedDigest: string | undefined,
): boolean {
  const presented = request.cookies?.[OAUTH_BINDING_COOKIE_NAME];
  if (!presented || !expectedDigest) return false;
  const actual = Buffer.from(digest(presented), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
}

function frontendBase(deps: MfaOAuthDeps, surface: Surface): string {
  return surface === 'customer' ? deps.storefrontBaseUrl : deps.adminBaseUrl;
}

function parseProvider(value: string): OAuthProviderName | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function sanitiseNext(input: string | undefined): string {
  if (!input || !input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}

function loginRedirect(
  deps: MfaOAuthDeps,
  surface: Surface,
  message: string,
  pagePath: (path: string) => string = (path) => path,
): string {
  const base = frontendBase(deps, surface);
  const path = `/login?error=${encodeURIComponent(message)}`;
  return `${base}${surface === 'customer' ? pagePath(path) : path}`;
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
  app.get<{ Params: { provider: string }; Querystring: { next?: string } }>(
    `/api/v1/auth/${surface}/oauth/:provider/start`,
    // Feature 154 — reachable whatever the sales-channel access rule decides:
    // this is how a visitor of a closed store starts signing in.
    { config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const provider = parseProvider(request.params.provider);
      if (!provider) return reply.redirect(loginRedirect(deps, surface, 'Unknown sign-in provider.'));

      const salesChannelId = surface === 'customer' ? (currentSalesChannel()?.id ?? null) : null;

      const policy = await deps.policyResolver.resolve(
        { subjectType: surface, subjectId: '' },
        { salesChannelId },
      );
      const settingEnabled = provider === 'google' ? policy.googleEnabled : policy.microsoftEnabled;
      if (!settingEnabled || !deps.oauthProvider.isEnabled(provider)) {
        return reply.redirect(
          loginRedirect(deps, surface, 'Sign-in with this provider is not available.'),
        );
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
    if (!provider || error || !code || !state) {
      return reply.redirect(loginRedirect(deps, surface, 'Sign-in was cancelled or failed.'));
    }
    const tx = await deps.challengeStore.getOAuthTransaction(state);
    // A callback from a browser that did not start this transaction is refused
    // without consuming it, so it cannot use up the attempt of the one that did.
    if (
      !tx ||
      tx.surface !== surface ||
      tx.provider !== provider ||
      !presentsBinding(request, tx.browserBinding)
    ) {
      return reply.redirect(loginRedirect(deps, surface, 'This sign-in attempt has expired.'));
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
      return reply.redirect(loginRedirect(deps, surface, 'Sign-in failed. Please try again.', pagePath));
    }

    const result =
      surface === 'customer'
        ? await deps.socialIdentityService.signInCustomer(identity, {
            salesChannelId: tx.salesChannelId,
          })
        : await deps.socialIdentityService.signInAdmin(identity);

    if (!result.ok) {
      if (result.reason === 'sales_channel_sign_in_required') {
        return reply.redirect(
          loginRedirect(deps, surface, SALES_CHANNEL_SIGN_IN_REQUIRED_LOGIN_ERROR, pagePath),
        );
      }
      const message =
        result.reason === 'unverified'
          ? 'Your provider email is not verified.'
          : result.reason === 'no_account'
            ? 'No account matches this provider. Please contact an administrator.'
            : result.reason === 'blocked'
              ? ACCOUNT_BLOCKED_MESSAGE
              : 'No account found. Please create an account first.';
      return reply.redirect(loginRedirect(deps, surface, message, pagePath));
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
        loginRedirect(deps, surface, SALES_CHANNEL_NOT_PERMITTED_LOGIN_ERROR, pagePath),
      );
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
    if (decision.kind === 'challenge') {
      if (surface === 'customer') {
        // The storefront's code screen reads the pending challenge from this
        // cookie — the one its own password sign-in sets — and it reaches the
        // storefront exactly as the session cookie below would have.
        reply.setCookie(MFA_CHALLENGE_COOKIE_NAME, decision.challengeId, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env['NODE_ENV'] === 'production',
          maxAge: MFA_CHALLENGE_MAX_AGE_SECONDS,
          signed: false,
        });
        return reply.redirect(
          `${deps.storefrontBaseUrl}${pagePath(`/login/mfa?next=${encodeURIComponent(sanitiseNext(tx.next))}`)}`,
        );
      }
      // The Admin UI holds the pending challenge in memory, as after its own
      // password step. The fragment is how it gets there: a fragment is never
      // sent to a server or in a `Referer`, and the Admin UI removes it from
      // the address bar as soon as it has read it.
      return reply.redirect(
        `${deps.adminBaseUrl}/#mfa-challenge=${encodeURIComponent(decision.challengeId)}`,
      );
    }
    if (decision.kind === 'setup') {
      return reply.redirect(loginRedirect(deps, surface, SETUP_REQUIRED_MESSAGE[surface], pagePath));
    }

    const session = await deps.sessionService.createSession(
      surface === 'customer'
        ? { kind: 'customer', customerAccountId: result.subjectId, ...ipUa(request) }
        : { kind: 'admin', adminUserId: result.subjectId, ...ipUa(request) },
    );
    setSessionCookie(
      reply,
      surface === 'customer' ? SESSION_COOKIE_NAME : ADMIN_SESSION_COOKIE_NAME,
      session.cookieValue,
      session.expiresAt,
    );
    const dest =
      surface === 'customer' ? `${deps.storefrontBaseUrl}${sanitiseNext(tx.next)}` : `${deps.adminBaseUrl}/`;
    return reply.redirect(dest);
  });
}

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
