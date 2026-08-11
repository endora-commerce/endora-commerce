import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { SessionService } from '../auth/services/session-service.js';
import { currentSalesChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
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
  sessionService: SessionService;
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
