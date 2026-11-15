/**
 * Federated sign-in callback rules (feature 042, US4/US5).
 *
 *  - The transaction is bound to the browser that started it: `start` leaves a
 *    short-lived, httpOnly cookie scoped to the surface's OAuth path, and the
 *    `callback` completes only when the same browser presents it again.
 *  - A refused sign-in comes back to the storefront or the Admin UI with a code
 *    from `federatedSignInErrorCodeSchema`, never a sentence (issues #789, #813).
 *  - A subject with a second factor (or under an enforced policy) is handed to
 *    the second-step flow the password sign-in uses; no session is issued by
 *    the callback itself.
 *
 * The provider, the account resolvers and the second-factor decision are
 * stand-ins; the transaction store is the real one over an in-memory Redis.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  federatedSignInErrorCodeSchema,
  type AuthSessionPort,
  type CustomerSignInCompletion,
  type CustomerSignInCompletionInput,
  type MfaLoginDecision,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
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
  /** Issue #1188 — what `organizations`' post-sign-in step was handed, in order. */
  completions: CustomerSignInCompletionInput[];
  setCompletion: (completion: CustomerSignInCompletion) => void;
  /** Issue #652 — what the preferred-language capture was asked, in order. */
  captured: Array<[string, string]>;
  setCaptureFails: (fails: boolean) => void;
}

async function build(
  options: { providerEnabled?: boolean; exchangeFails?: boolean } = {},
): Promise<Harness> {
  const app = Fastify();
  await app.register(fastifyCookie, { secret: 'test-cookie-secret-test-cookie-secret' });

  const challengeStore = new ChallengeStore(memoryRedis());
  let customerResult: SocialSignInResult = { ok: true, subjectId: 'c1', organizationId: 'o1' };
  let adminResult: SocialSignInResult = { ok: true, subjectId: 'a1', organizationId: null };
  let decision: MfaLoginDecision = { kind: 'proceed' };
  let permitted = true;
  const permits = vi.fn(async () => permitted);
  const signInCustomer = vi.fn(async () => customerResult);
  const completions: CustomerSignInCompletionInput[] = [];
  let completion: CustomerSignInCompletion = { cartMerge: null, clearAnonymousCartCookie: false };
  const captured: Array<[string, string]> = [];
  let captureFails = false;

  const beginLogin = vi.fn(async () => decision);
  const createSession = vi.fn(async () => ({
    cookieValue: 'session-cookie',
    expiresAt: new Date(Date.now() + 60_000),
  }));

  const oauthProvider: OAuthProviderPort = {
    isEnabled: () => options.providerEnabled ?? true,
    buildAuthorizationUrl: async (provider, { state }) =>
      `https://idp.test/${provider}/authorize?state=${encodeURIComponent(state)}`,
    exchangeCode: async (provider, { code }) => {
      if (options.exchangeFails) throw new Error('invalid_grant');
      return { provider, sub: `sub-${code}`, email: code, emailVerified: true };
    },
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
    customerSignInCompletion: {
      complete: async (input) => {
        completions.push(input);
        return completion;
      },
    },
    customerLanguageCapture: {
      captureIfUnset: async (customerAccountId, tag) => {
        if (captureFails) throw new Error('database blip');
        captured.push([customerAccountId, tag]);
      },
    },
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
    completions,
    setCompletion: (c) => {
      completion = c;
    },
    captured,
    setCaptureFails: (fails) => {
      captureFails = fails;
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
    expect(res.headers['location']).toBe(`${STOREFRONT}/login?error=sign_in_expired`);
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

  it('is refused with the account_blocked code, and gets no session', async () => {
    h.setCustomerResult({ ok: false, reason: 'blocked' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/pl/login?error=account_blocked`);
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

  it('issues no customer session while two-factor setup is still required', async () => {
    h.setDecision({ kind: 'setup', setupTicket: 'ticket-1' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/pl/login?error=mfa_setup_required`);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('issues no admin session while two-factor setup is still required', async () => {
    h.setDecision({ kind: 'setup', setupTicket: 'ticket-1' });
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${ADMIN}/login?error=mfa_setup_required`);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('signs in directly when the subject has no second factor and none is enforced', async () => {
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(res.headers['location']).toBe(`${ADMIN}/`);
    expect(sessionCookie(res, 'b2b_admin_session')?.value).toBe('session-cookie');
  });
});

/**
 * Issue #1188 — a federated sign-in carries the signed-out basket over, as the
 * password sign-in and (since #368) the second step do.
 *
 * The callback establishes the session itself when no second step is needed,
 * so it is where `organizations`' post-sign-in step runs: the request's cookies
 * (the browser's `b2b_cart_anon`, which travels on the provider's top-level
 * redirect exactly as the session cookie set here travels back) and the channel
 * the sign-in was **started** on, because the provider's redirect carries none.
 * The storefront is not in the loop on this path, so the callback also drops
 * the drained anonymous cookie and leaves the merge notice's flash cookie the
 * storefront's sign-in actions leave.
 */
describe('federated sign-in — the signed-out basket is carried over (#1188)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  const MERGED: CustomerSignInCompletion = {
    cartMerge: { outcome: 'merged', destinationCartId: 'cart-1' },
    clearAnonymousCartCookie: true,
  };

  const anonCleared = (res: LightMyRequestResponse) =>
    res.cookies.some(
      (c) =>
        c.name === 'b2b_cart_anon' &&
        c.value === '' &&
        c.path === '/' &&
        (c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now())),
    );

  it('hands the request cookies and the started-on channel to the completion step once the session is set', async () => {
    h.setCompletion(MERGED);
    const binding = 'binding-1188';
    const state = await h.challengeStore.issueOAuthTransaction({
      surface: 'customer',
      provider: 'google',
      salesChannelId: 'channel-started-on',
      pkceVerifier: 'verifier',
      nonce: 'nonce',
      next: '/account/orders',
      language: null,
      browserBinding: createHash('sha256').update(binding).digest('hex'),
    });
    const res = await callback(h, state, {
      [OAUTH_BINDING_COOKIE_NAME]: binding,
      b2b_cart_anon: 'anon-1188',
      compare_token: 'cmp-1188',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/account/orders`);
    expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
    expect(h.completions).toHaveLength(1);
    expect(h.completions[0]).toMatchObject({
      customerAccountId: 'c1',
      salesChannelId: 'channel-started-on',
    });
    expect(h.completions[0]!.cookies['b2b_cart_anon']).toBe('anon-1188');
    expect(h.completions[0]!.cookies['compare_token']).toBe('cmp-1188');
  });

  it.each(['merged', 'adopted'] as const)(
    'a %s basket clears the anonymous cookie and leaves the merge notice for the storefront',
    async (outcome) => {
      h.setCompletion({ cartMerge: { outcome, destinationCartId: 'cart-1' }, clearAnonymousCartCookie: true });
      const { state, binding } = await start(h);
      const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' });

      expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
      expect(anonCleared(res)).toBe(true);
      expect(res.cookies.find((c) => c.name === 'b2b_cart_merge_flash')).toMatchObject({
        value: outcome,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 30,
      });
    },
  );

  it('an emptied basket (noop) clears the anonymous cookie but shows no notice', async () => {
    h.setCompletion({ cartMerge: { outcome: 'noop', destinationCartId: 'cart-1' }, clearAnonymousCartCookie: true });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' });

    expect(anonCleared(res)).toBe(true);
    expect(res.cookies.find((c) => c.name === 'b2b_cart_merge_flash')).toBeUndefined();
  });

  it('nothing merged (no basket, a failed merge) keeps the anonymous cookie and shows no notice', async () => {
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' });

    expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
    expect(h.completions).toHaveLength(1);
    expect(res.cookies.some((c) => c.name === 'b2b_cart_anon')).toBe(false);
    expect(res.cookies.find((c) => c.name === 'b2b_cart_merge_flash')).toBeUndefined();
  });

  it('a customer handed to the second step is not completed here — the code screen completes it', async () => {
    h.setCompletion(MERGED);
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' });

    expect(h.completions).toEqual([]);
    expect(res.cookies.some((c) => c.name === 'b2b_cart_anon')).toBe(false);
  });

  it('a refused sign-in is not completed', async () => {
    h.setCompletion(MERGED);
    h.setPermitted(false);
    const { state, binding } = await start(h);
    await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' });
    expect(h.completions).toEqual([]);
  });

  it('the admin surface never calls the customer completion step', async () => {
    h.setCompletion(MERGED);
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding!, b2b_cart_anon: 'anon-1188' }, 'admin');

    expect(sessionCookie(res, 'b2b_admin_session')?.value).toBe('session-cookie');
    expect(h.completions).toEqual([]);
    expect(res.cookies.some((c) => c.name === 'b2b_cart_anon' || c.name === 'b2b_cart_merge_flash')).toBe(false);
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
      // Issue #652 — with the language the account would record: here the
      // channel default, the starting page having named none.
      { salesChannelId: null, preferredLanguage: 'pl-PL' },
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

/**
 * Issue #652 (D-292) — an accepted customer sign-in hands the account the
 * starting page's language, resolved against the started-on channel; the port
 * fills it only while the account has none. A refused sign-in hands it nothing,
 * an administrator's sign-in is not a customer's, and a failed capture does not
 * fail the sign-in.
 */
describe('federated sign-in — the account language (#652)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('offers the starting page’s language, as the channel spells it, to a new and an existing account', async () => {
    const { state, binding } = await start(h, 'customer', '/en/account');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/account`);
    expect(h.signInCustomer.mock.calls[0]?.[1]).toMatchObject({ preferredLanguage: 'en-US' });
    expect(h.captured).toEqual([['c1', 'en-US']]);
  });

  it('captures before the second factor is asked for', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { state, binding } = await start(h, 'customer', '/en/account');
    await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(h.captured).toEqual([['c1', 'en-US']]);
  });

  it('captures nothing for a refused sign-in', async () => {
    h.setPermitted(false);
    const refusedByChannel = await start(h, 'customer', '/en/account');
    await callback(h, refusedByChannel.state, { [OAUTH_BINDING_COOKIE_NAME]: refusedByChannel.binding! });

    h.setPermitted(true);
    h.setCustomerResult({ ok: false, reason: 'blocked' });
    const blocked = await start(h, 'customer', '/en/account');
    await callback(h, blocked.state, { [OAUTH_BINDING_COOKIE_NAME]: blocked.binding! });

    expect(h.captured).toEqual([]);
  });

  it('captures nothing for an administrator', async () => {
    const { state, binding } = await start(h, 'admin');
    await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(h.captured).toEqual([]);
  });

  it('signs the customer in even when the capture fails', async () => {
    h.setCaptureFails(true);
    const { state, binding } = await start(h, 'customer', '/en/account');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/account`);
    expect(sessionCookie(res, 'b2b_session')).toBeDefined();
  });
});

/**
 * Issue #789 — every refusal the callback sends a browser back to the storefront with
 * carries a code from `federatedSignInErrorCodeSchema`, which the storefront words in its
 * own languages. A sentence there was a lookup key the storefront had to match verbatim,
 * and anything else — a reworded sentence included — read as the generic failure.
 */
describe('federated sign-in — the storefront gets a code, never a sentence (issue #789)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  const errorOf = (res: LightMyRequestResponse): string | null =>
    new URL(res.headers['location'] as string).searchParams.get('error');

  it('an unknown provider', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/customer/oauth/yahoo/start' });
    expect(res.headers['location']).toBe(`${STOREFRONT}/login?error=unknown_provider`);
  });

  it('a provider that is not available', async () => {
    const unavailable = await build({ providerEnabled: false });
    try {
      const res = await unavailable.app.inject({ method: 'GET', url: '/api/v1/auth/customer/oauth/google/start' });
      expect(res.headers['location']).toBe(`${STOREFRONT}/login?error=provider_unavailable`);
    } finally {
      await unavailable.app.close();
    }
  });

  it('a callback for an unknown provider', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/customer/oauth/yahoo/callback' });
    expect(errorOf(res)).toBe('sign_in_cancelled');
  });

  it('a provider that answers with an error', async () => {
    const { state, binding } = await start(h);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      cookies: { [OAUTH_BINDING_COOKIE_NAME]: binding! },
    });
    expect(res.headers['location']).toBe(`${STOREFRONT}/login?error=sign_in_cancelled`);
  });

  it.each([
    [{ ok: false, reason: 'unverified' }, 'email_unverified'],
    [{ ok: false, reason: 'blocked' }, 'account_blocked'],
    [{ ok: false, reason: 'registration_disabled_in_channel' }, 'registration_disabled_in_channel'],
    [{ ok: false, reason: 'sales_channel_sign_in_required' }, 'sales_channel_sign_in_required'],
  ] as const)('a refused account resolution (%o) reads %s', async (result, code) => {
    h.setCustomerResult(result);
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/pl/login?error=${code}`);
  });

  it('a code exchange the provider refuses', async () => {
    const failing = await build({ exchangeFails: true });
    try {
      const { state, binding } = await start(failing);
      const res = await callback(failing, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
      expect(res.headers['location']).toBe(`${STOREFRONT}/pl/login?error=sign_in_failed`);
    } finally {
      await failing.app.close();
    }
  });

  it('every code the storefront can receive is one the contract names', () => {
    for (const code of [
      'unknown_provider',
      'provider_unavailable',
      'sign_in_cancelled',
      'sign_in_expired',
      'sign_in_failed',
      'email_unverified',
      'no_matching_account',
      'account_blocked',
      'registration_disabled_in_channel',
      'mfa_setup_required',
      'sales_channel_sign_in_required',
      'sales_channel_not_permitted',
    ]) {
      expect(federatedSignInErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  // The static net beside the behaviour above, as `storefront/test/url-errors/no-sentence-in-url.test.ts`
  // is for the storefront's own pages: every refusal `routes.oauth.ts` sends names a contract code.
  it('every loginRedirect call in routes.oauth.ts names a contract code', () => {
    const source = readFileSync(new URL('./routes.oauth.ts', import.meta.url), 'utf8');
    const literals = [...source.matchAll(/loginRedirect\(\s*deps,\s*surface,\s*'([^']*)'/g)].map((m) => m[1]!);
    expect(literals.length).toBeGreaterThan(0);
    expect(literals.filter((code) => !federatedSignInErrorCodeSchema.safeParse(code).success)).toEqual([]);
    expect(source).not.toMatch(/\?error=\$\{encodeURIComponent\(/);
    expect(source).not.toMatch(/ADMIN_LOGIN_ERROR_SENTENCE/);
  });

  it('the Admin UI gets the code too, never a sentence (issue #813)', async () => {
    h.setAdminResult({ ok: false, reason: 'no_account' });
    const { state, binding } = await start(h, 'admin');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }, 'admin');
    expect(res.headers['location']).toBe(`${ADMIN}/login?error=no_matching_account`);
  });
});
