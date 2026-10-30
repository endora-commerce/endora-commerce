/**
 * Federated sign-in callback rules (feature 042, US4/US5).
 *
 *  - The transaction is bound to the browser that started it: `start` leaves a
 *    short-lived, httpOnly cookie scoped to the surface's OAuth path, and the
 *    `callback` completes only when the same browser presents it again.
 *  - A blocked customer account is refused with the sentence the password
 *    sign-in uses.
 *  - A subject with a second factor (or under an enforced policy) is handed to
 *    the second-step flow the password sign-in uses; no session is issued by
 *    the callback itself.
 *
 * The provider, the account resolvers and the second-factor decision are
 * stand-ins; the transaction store is the real one over an in-memory Redis.
 */
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionPort, MfaLoginDecision, MfaLoginPort } from '@endora-commerce/contracts';
import { ChallengeStore } from './services/challenge-store.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';
import type { OAuthProviderPort } from './services/oauth-provider-service.js';
import type { SocialIdentityService, SocialSignInResult } from './services/social-identity-service.js';
import { OAUTH_BINDING_COOKIE_NAME, registerMfaOAuthRoutes } from './routes.oauth.js';

const STOREFRONT = 'https://shop.test';
const ADMIN = 'https://admin.test';

function memoryRedis(): Redis {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },
  } as unknown as Redis;
}

interface Harness {
  app: FastifyInstance;
  challengeStore: ChallengeStore;
  beginLogin: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  setCustomerResult: (result: SocialSignInResult) => void;
  setAdminResult: (result: SocialSignInResult) => void;
  setDecision: (decision: MfaLoginDecision) => void;
  permits: ReturnType<typeof vi.fn>;
  signInCustomer: ReturnType<typeof vi.fn>;
  setPermitted: (permitted: boolean) => void;
}

async function build(): Promise<Harness> {
  const app = Fastify();
  await app.register(fastifyCookie, { secret: 'test-cookie-secret-test-cookie-secret' });

  const challengeStore = new ChallengeStore(memoryRedis());
  let customerResult: SocialSignInResult = { ok: true, subjectId: 'c1', organizationId: 'o1' };
  let adminResult: SocialSignInResult = { ok: true, subjectId: 'a1', organizationId: null };
  let decision: MfaLoginDecision = { kind: 'proceed' };
  let permitted = true;
  const permits = vi.fn(async () => permitted);
  const signInCustomer = vi.fn(async () => customerResult);

  const beginLogin = vi.fn(async () => decision);
  const createSession = vi.fn(async () => ({
    cookieValue: 'session-cookie',
    expiresAt: new Date(Date.now() + 60_000),
  }));

  const oauthProvider: OAuthProviderPort = {
    isEnabled: () => true,
    buildAuthorizationUrl: async (provider, { state }) =>
      `https://idp.test/${provider}/authorize?state=${encodeURIComponent(state)}`,
    exchangeCode: async (provider, { code }) => ({
      provider,
      sub: `sub-${code}`,
      email: code,
      emailVerified: true,
    }),
  };

  await registerMfaOAuthRoutes(app, {
    oauthProvider,
    challengeStore,
    policyResolver: {
      resolve: async () => ({ googleEnabled: true, microsoftEnabled: true, totpEnforced: false }),
    } as unknown as MfaPolicyResolver,
    socialIdentityService: {
      signInCustomer,
      signInAdmin: async () => adminResult,
    } as unknown as SocialIdentityService,
    loginService: { beginLogin } as unknown as MfaLoginPort,
    sessionService: { createSession } as unknown as AuthSessionPort,
    backendBaseUrl: 'https://api.test',
    storefrontBaseUrl: STOREFRONT,
    adminBaseUrl: ADMIN,
    // Feature 167 — the started-on channel's URL languages (pl-PL default, prefixed; en-US).
    channelUrlFactsFor: async () => ({
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      prefixDefaultLanguage: true,
    }),
    customerChannelAccess: { permits },
  });
  await app.ready();

  return {
    app,
    challengeStore,
    beginLogin,
    createSession,
    setCustomerResult: (r) => {
      customerResult = r;
    },
    setAdminResult: (r) => {
      adminResult = r;
    },
    setDecision: (d) => {
      decision = d;
    },
    permits,
    signInCustomer,
    setPermitted: (p) => {
      permitted = p;
    },
  };
}

type Surface = 'customer' | 'admin';

async function start(
  h: Harness,
  surface: Surface = 'customer',
  next?: string,
): Promise<{ state: string; binding: string | undefined; response: LightMyRequestResponse }> {
  const provider = surface === 'customer' ? 'google' : 'microsoft';
  const response = await h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/${surface}/oauth/${provider}/start${next ? `?next=${encodeURIComponent(next)}` : ''}`,
  });
  expect(response.statusCode).toBe(302);
  const state = new URL(response.headers['location'] as string).searchParams.get('state')!;
  const binding = response.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME)?.value;
  return { state, binding, response };
}

function callback(
  h: Harness,
  state: string,
  cookies: Record<string, string>,
  surface: Surface = 'customer',
): Promise<LightMyRequestResponse> {
  const provider = surface === 'customer' ? 'google' : 'microsoft';
  return h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/${surface}/oauth/${provider}/callback?code=buyer%40example.com&state=${encodeURIComponent(state)}`,
    cookies,
  });
}

const sessionCookie = (res: LightMyRequestResponse, name: string) =>
  res.cookies.find((c) => c.name === name && c.value !== '');

describe('federated sign-in — the transaction belongs to the browser that started it', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it.each(['customer', 'admin'] as const)(
    'start leaves an httpOnly, SameSite=Lax cookie scoped to the %s OAuth path',
    async (surface) => {
      const { response } = await start(h, surface);
      const cookie = response.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME);
      expect(cookie?.value).toBeTruthy();
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: 'Lax',
        path: `/api/v1/auth/${surface}/oauth`,
        maxAge: 600,
      });
    },
  );

  it('refuses a callback that carries no binding cookie, and issues no session', async () => {
    const { state } = await start(h);
    const res = await callback(h, state, {});
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(
      `${STOREFRONT}/login?error=${encodeURIComponent('This sign-in attempt has expired.')}`,
    );
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
  });

  it('refuses a callback whose binding cookie belongs to another transaction', async () => {
    const first = await start(h);
    const second = await start(h);
    const res = await callback(h, first.state, { [OAUTH_BINDING_COOKIE_NAME]: second.binding! });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    expect(h.createSession).not.toHaveBeenCalled();
    // A stray callback does not use up the transaction of the browser that owns it.
    expect(await h.challengeStore.getOAuthTransaction(first.state)).not.toBeNull();
  });

  it('refuses the same binding on the other surface', async () => {
    const { state, binding } = await start(h, 'customer');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(res.headers['location']).toContain('/login?error=');
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('completes for the browser that started it, clears the binding and consumes the transaction', async () => {
    const { state, binding } = await start(h, 'customer', '/account/orders');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/account/orders`);
    expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
    const cleared = res.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME);
    expect(cleared?.value).toBe('');
    expect(cleared?.path).toBe('/api/v1/auth/customer/oauth');
    expect(await h.challengeStore.getOAuthTransaction(state)).toBeNull();

    // And the transaction cannot be completed twice.
    const replay = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(replay.headers['location']).toContain('/login?error=');
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });
});

describe('federated sign-in — a blocked customer account', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('is refused with the sentence the password sign-in uses, and gets no session', async () => {
    h.setCustomerResult({ ok: false, reason: 'blocked' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(
      `${STOREFRONT}/pl/login?error=${encodeURIComponent('This account has been blocked. Please contact support.')}`,
    );
    expect(h.beginLogin).not.toHaveBeenCalled();
    expect(h.createSession).not.toHaveBeenCalled();
  });
});

describe('federated sign-in — the second factor', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('asks the second-factor decision with the customer’s organisation and channel', async () => {
    const { state, binding } = await start(h);
    await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(h.beginLogin).toHaveBeenCalledWith(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: null, organizationId: 'o1' },
    );
  });

  it('hands an enrolled customer to the storefront code screen instead of signing them in', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { state, binding } = await start(h, 'customer', '/account/orders');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(
      `${STOREFRONT}/pl/login/mfa?next=${encodeURIComponent('/account/orders')}`,
    );
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
    const challenge = res.cookies.find((c) => c.name === 'b2b_mfa_challenge');
    expect(challenge).toMatchObject({
      value: 'challenge-1',
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 300,
    });
  });

  it('hands an enrolled administrator to the Admin UI code screen instead of signing them in', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-2' });
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');

    expect(h.beginLogin).toHaveBeenCalledWith(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null, organizationId: null },
    );
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${ADMIN}/#mfa-challenge=challenge-2`);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_admin_session')).toBeUndefined();
  });

  it.each(['customer', 'admin'] as const)(
    'issues no %s session while two-factor setup is still required',
    async (surface) => {
      h.setDecision({ kind: 'setup', setupTicket: 'ticket-1' });
      const { state, binding } = await start(h, surface);
      const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, surface);
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toContain('/login?error=');
      expect(decodeURIComponent(res.headers['location'] as string)).toContain(
        'Two-factor authentication is required for your account.',
      );
      expect(h.createSession).not.toHaveBeenCalled();
    },
  );

  it('signs in directly when the subject has no second factor and none is enforced', async () => {
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(res.headers['location']).toBe(`${ADMIN}/`);
    expect(sessionCookie(res, 'b2b_admin_session')?.value).toBe('session-cookie');
  });
});

describe('federated sign-in — the sales-channel access rule (feature 154)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('sends a customer whose Organization may not use the started-on channel back to the sign-in page', async () => {
    h.setPermitted(false);
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/pl/login?error=sales_channel_not_permitted`);
    // Decided on the transaction's channel and the account's Organization …
    expect(h.permits).toHaveBeenCalledWith('o1', null);
    // … before a second factor is started or a session issued.
    expect(h.beginLogin).not.toHaveBeenCalled();
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
  });

  it('does not ask about an administrator', async () => {
    h.setPermitted(false);
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(h.permits).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_admin_session')?.value).toBe('session-cookie');
  });

  it('passes the started-on channel to the account resolution', async () => {
    const { state, binding } = await start(h);
    await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(h.signInCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'buyer@example.com' }),
      { salesChannelId: null },
    );
  });

  it('sends a would-be new account on a channel closed to anonymous visitors back to the sign-in page', async () => {
    h.setCustomerResult({ ok: false, reason: 'sales_channel_sign_in_required' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(
      `${STOREFRONT}/pl/login?error=sales_channel_sign_in_required`,
    );
    expect(h.beginLogin).not.toHaveBeenCalled();
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
  });
});

/**
 * Feature 167 (US6, FR-034) — the storefront pages the federated sign-in returns to
 * carry the language of the page that started it: the transaction records it from the
 * prefixed `next` the storefront sends, and `next` itself is passed through unchanged.
 */
describe('federated sign-in — the language of the starting page', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('returns an enrolled customer to the code screen in the starting language', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { state, binding } = await start(h, 'customer', '/en/account/orders');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/login/mfa?next=${encodeURIComponent('/en/account/orders')}`);
  });

  it('returns a refused customer to the sign-in page in the starting language', async () => {
    h.setPermitted(false);
    const { state, binding } = await start(h, 'customer', '/en/cart');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/login?error=sales_channel_not_permitted`);
  });

  it('passes next through unchanged on success', async () => {
    const { state, binding } = await start(h, 'customer', '/en/account');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/account`);
  });
});
