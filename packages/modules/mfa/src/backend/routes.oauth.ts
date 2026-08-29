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
import { randomBytes } from 'crypto';
import { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import type { AuthSessionPort, FederatedSignInOptionsResponse } from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import type { ChallengeStore } from './services/challenge-store.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';
import type { SocialIdentityService } from './services/social-identity-service.js';
import type {
  OAuthProviderName,
  OAuthProviderPort,
} from './services/oauth-provider-service.js';

/**
 * Federated sign-in routes (feature 042, US4 customer / US5 admin). Per surface
 * + provider: a `start` endpoint that redirects to the IdP, and a `callback`
 * that validates the transaction, exchanges the code, resolves the account, and
 * issues a session. A social-authenticated session is granted directly — no
 * additional TOTP step (R10).
 */
export interface MfaOAuthDeps {
  oauthProvider: OAuthProviderPort;
  challengeStore: ChallengeStore;
  policyResolver: MfaPolicyResolver;
  socialIdentityService: SocialIdentityService;
  sessionService: AuthSessionPort;
  /** Public base URL of the backend (for the provider redirect_uri). */
  backendBaseUrl: string;
  storefrontBaseUrl: string;
  adminBaseUrl: string;
}

type Surface = 'customer' | 'admin';

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

function loginRedirect(deps: MfaOAuthDeps, surface: Surface, message: string): string {
  const base = frontendBase(deps, surface);
  return `${base}/login?error=${encodeURIComponent(message)}`;
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
  app.get(`/api/v1/auth/${surface}/oauth/providers`, async (_request, reply) => {
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
      const codeVerifier = randomBytes(32).toString('base64url');
      const nonce = randomBytes(16).toString('base64url');
      const state = await deps.challengeStore.issueOAuthTransaction({
        surface,
        provider,
        salesChannelId,
        pkceVerifier: codeVerifier,
        nonce,
        next,
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
  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>(`/api/v1/auth/${surface}/oauth/:provider/callback`, async (request, reply) => {
    const provider = parseProvider(request.params.provider);
    const { code, state, error } = request.query;
    if (!provider || error || !code || !state) {
      return reply.redirect(loginRedirect(deps, surface, 'Sign-in was cancelled or failed.'));
    }
    const tx = await deps.challengeStore.getOAuthTransaction(state);
    if (!tx || tx.surface !== surface || tx.provider !== provider) {
      return reply.redirect(loginRedirect(deps, surface, 'This sign-in attempt has expired.'));
    }
    await deps.challengeStore.consumeOAuthTransaction(state);

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
      return reply.redirect(loginRedirect(deps, surface, 'Sign-in failed. Please try again.'));
    }

    const result =
      surface === 'customer'
        ? await deps.socialIdentityService.signInCustomer(identity)
        : await deps.socialIdentityService.signInAdmin(identity);

    if (!result.ok) {
      const message =
        result.reason === 'unverified'
          ? 'Your provider email is not verified.'
          : result.reason === 'no_account'
            ? 'No account matches this provider. Please contact an administrator.'
            : 'No account found. Please create an account first.';
      return reply.redirect(loginRedirect(deps, surface, message));
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
