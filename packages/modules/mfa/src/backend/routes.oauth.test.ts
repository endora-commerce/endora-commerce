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
 *  - Issue #1279 — the customer callback sets **no cookie**. It leaves a
 *    single-use hand-off code and sends the browser to the channel's own
 *    storefront (`/auth/federated/complete?code=…`), which redeems it
 *    server-to-server through `POST /api/v1/auth/customer/oauth/exchange` and
 *    sets its own cookies. That is what makes the sign-in work when the API is
 *    on another host than the storefront.
 *
 * The provider, the account resolvers and the second-factor decision are
 * stand-ins; the transaction store is the real one over an in-memory Redis.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { validatorCompiler } from '@fastify/type-provider-zod';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  federatedSignInErrorCodeSchema,
  federatedSignInExchangeResponseSchema,
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

/** The request's resolved sales channel, as the platform's resolver would leave it. */
const channel = vi.hoisted(() => ({
  current: null as { id: string; languages?: string[]; defaultLanguage?: string } | null,
}));
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channel.current,
}));

const STOREFRONT = 'https://shop.test';
const ADMIN = 'https://admin.test';
/** Issue #1279 — a channel whose storefront is on a host of its own. */
const SPLIT_CHANNEL = 'channel-split';
const SPLIT_STOREFRONT = 'https://split-shop.test';
const EXCHANGE = '/api/v1/auth/customer/oauth/exchange';
const COMPLETE = '/auth/federated/complete';

interface MemoryRedis {
  redis: Redis;
  store: Map<string, string>;
  ttl: Map<string, number>;
}

function memoryRedis(): MemoryRedis {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  const redis = {
    get: async (key: string) => store.get(key) ?? null,
    getdel: async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    set: async (key: string, value: string, mode?: string, seconds?: number) => {
      store.set(key, value);
      if (mode === 'EX' && seconds !== undefined) ttl.set(key, seconds);
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },
  } as unknown as Redis;
  return { redis, store, ttl };
}

interface Harness {
  app: FastifyInstance;
  challengeStore: ChallengeStore;
  redis: MemoryRedis;
  /** Everything the app logged, as written. */
  logs: string[];
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
}

async function build(
  options: { providerEnabled?: boolean; exchangeFails?: boolean } = {},
): Promise<Harness> {
  const logs: string[] = [];
  const app = Fastify({
    logger: {
      level: 'info',
      stream: new Writable({
        write(chunk, _encoding, done) {
          logs.push(String(chunk));
          done();
        },
      }),
    },
  });
  await app.register(fastifyCookie, { secret: 'test-cookie-secret-test-cookie-secret' });
  // The host's validator and the shape of its error envelope, as far as these tests read it.
  app.setValidatorCompiler(validatorCompiler);
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; validation?: unknown }, _req, reply) => {
    void reply
      .status(err.validation ? 400 : (err.statusCode ?? 500))
      .send({ error: { code: err.validation ? 'VALIDATION_ERROR' : err.code } });
  });

  const redis = memoryRedis();
  const challengeStore = new ChallengeStore(redis.redis);
  let customerResult: SocialSignInResult = { ok: true, subjectId: 'c1', organizationId: 'o1' };
  let adminResult: SocialSignInResult = { ok: true, subjectId: 'a1', organizationId: null };
  let decision: MfaLoginDecision = { kind: 'proceed' };
  let permitted = true;
  const permits = vi.fn(async () => permitted);
  const signInCustomer = vi.fn(async () => customerResult);
  const completions: CustomerSignInCompletionInput[] = [];
  let completion: CustomerSignInCompletion = { cartMerge: null, clearAnonymousCartCookie: false };

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
    // Issue #1279 — the channel's `sales_channels.storefront_url`, else the fallback.
    storefrontOriginFor: async (salesChannelId) =>
      salesChannelId === SPLIT_CHANNEL ? SPLIT_STOREFRONT : STOREFRONT,
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
  });
  await app.ready();

  return {
    app,
    challengeStore,
    redis,
    logs,
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
  };
}

type Surface = 'customer' | 'admin';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface Started {
  state: string;
  /** The API host's start↔callback binding cookie. */
  binding: string | undefined;
  /** Issue #1279 — the storefront's binding secret, whose digest `start` was given. */
  secret: string;
  response: LightMyRequestResponse;
}

async function start(h: Harness, surface: Surface = 'customer', next?: string): Promise<Started> {
  const provider = surface === 'customer' ? 'google' : 'microsoft';
  const secret = randomBytes(32).toString('base64url');
  const query = new URLSearchParams();
  if (next) query.set('next', next);
  if (surface === 'customer') query.set('binding', sha256(secret));
  const response = await h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/${surface}/oauth/${provider}/start?${query.toString()}`,
  });
  expect(response.statusCode).toBe(302);
  const state = new URL(response.headers['location'] as string).searchParams.get('state')!;
  const binding = response.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME)?.value;
  return { state, binding, secret, response };
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
    url: `/api/v1/auth/${surface}/oauth/${provider}/callback?code=${encodeURIComponent('buyer@example.com')}&state=${encodeURIComponent(state)}`,
    cookies,
  });
}

/** The hand-off code a customer callback sent the browser to the storefront with. */
function handoffCode(res: LightMyRequestResponse, origin = STOREFRONT): string {
  expect(res.statusCode).toBe(302);
  const location = new URL(res.headers['location'] as string);
  expect(`${location.origin}${location.pathname}`).toBe(`${origin}${COMPLETE}`);
  return location.searchParams.get('code')!;
}

/** The storefront's server-to-server redemption of a hand-off code. */
function exchange(
  h: Harness,
  code: string,
  binding: string,
  cookies: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({ method: 'POST', url: EXCHANGE, payload: { code, binding }, cookies });
}

/** Start, callback and exchange — the whole customer sign-in. */
async function signIn(
  h: Harness,
  next?: string,
  cookies: Record<string, string> = {},
): Promise<{ callback: LightMyRequestResponse; exchange: LightMyRequestResponse }> {
  const started = await start(h, 'customer', next);
  const back = await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! });
  const redeemed = await exchange(h, handoffCode(back), started.secret, cookies);
  return { callback: back, exchange: redeemed };
}

const sessionCookie = (res: LightMyRequestResponse, name: string) =>
  res.cookies.find((c) => c.name === name && c.value !== '');

const SIGN_IN_COOKIES = ['b2b_session', 'b2b_mfa_challenge', 'b2b_cart_merge_flash'];

function expectHandoffRefused(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(400);
  expect(res.json().error?.code).toBe('MFA_FEDERATED_HANDOFF_INVALID');
  expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
}

beforeEach(() => {
  channel.current = null;
});

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
    expect(handoffCode(res)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cleared = res.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME);
    expect(cleared?.value).toBe('');
    expect(cleared?.path).toBe('/api/v1/auth/customer/oauth');
    expect(await h.challengeStore.getOAuthTransaction(state)).toBeNull();

    // And the transaction cannot be completed twice.
    const replay = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(replay.headers['location']).toContain('/login?error=');
  });
});

/**
 * Issue #1279 — the storefront starts the flow on its own host and binds it to
 * the browser there: `start` is refused without the digest of that binding.
 */
describe('federated sign-in — the customer start requires the storefront binding (#1279)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it.each([
    ['missing', ''],
    ['malformed', '?binding=not-a-digest'],
  ])('refuses a start whose binding is %s, and names it in a warning', async (_label, query) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/auth/customer/oauth/google/start${query}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe(`${STOREFRONT}/login?error=sign_in_failed`);
    expect(res.cookies.some((c) => c.name === OAUTH_BINDING_COOKIE_NAME)).toBe(false);
    expect(h.logs.some((line) => line.includes('"level":40') && line.includes('binding'))).toBe(true);
  });

  it('the admin surface does not ask for one', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/admin/oauth/microsoft/start' });
    expect(res.headers['location']).toMatch(/^https:\/\/idp\.test\/microsoft\/authorize/);
  });

  it('sends a refused start back to the started-on channel’s own storefront', async () => {
    channel.current = { id: SPLIT_CHANNEL };
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/auth/customer/oauth/google/start' });
    expect(res.headers['location']).toBe(`${SPLIT_STOREFRONT}/login?error=sign_in_failed`);
  });
});

/**
 * Issue #1279 — the callback sets none of the storefront's cookies (they would
 * land on the API host) and leaves a hand-off for the channel's storefront.
 */
describe('federated sign-in — the callback hands off to the channel’s storefront (#1279)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('sets no sign-in cookie and sends the browser to the landing route of the channel’s storefront', async () => {
    channel.current = { id: SPLIT_CHANNEL };
    const { state, binding } = await start(h, 'customer', '/account/orders');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });

    const code = handoffCode(res, SPLIT_STOREFRONT);
    expect(code).toBeTruthy();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    for (const name of SIGN_IN_COOKIES) expect(res.cookies.some((c) => c.name === name)).toBe(false);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.completions).toEqual([]);
  });

  it('a challenged customer gets no challenge cookie either', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    handoffCode(res);
    for (const name of SIGN_IN_COOKIES) expect(res.cookies.some((c) => c.name === name)).toBe(false);
  });

  it('stores only the digest of the code, for sixty seconds', async () => {
    const { state, binding } = await start(h);
    const code = handoffCode(await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! }));
    const key = `mfa:oauth:handoff:${sha256(code)}`;
    expect(h.redis.store.has(key)).toBe(true);
    expect(h.redis.ttl.get(key)).toBe(60);
    expect([...h.redis.store.keys(), ...h.redis.store.values()].some((v) => v.includes(code))).toBe(false);
  });

  it('a refusal goes back to the started-on channel’s own storefront', async () => {
    channel.current = { id: SPLIT_CHANNEL };
    h.setPermitted(false);
    const { state, binding } = await start(h);
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${SPLIT_STOREFRONT}/pl/login?error=sales_channel_not_permitted`);
  });
});

/** Issue #1279 — the storefront's server-to-server redemption. */
describe('federated sign-in — the exchange (#1279)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('signs the customer in: the session in Set-Cookie, the path to go to in the body', async () => {
    const { exchange: res } = await signIn(h, '/account/orders');

    expect(res.statusCode).toBe(200);
    const body = federatedSignInExchangeResponseSchema.parse(res.json());
    expect(body.data).toEqual({ status: 'authenticated', redirectPath: '/account/orders', cartMerge: null });
    expect(sessionCookie(res, 'b2b_session')).toMatchObject({
      value: 'session-cookie',
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(h.createSession).toHaveBeenCalledTimes(1);
    expect(h.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'customer', customerAccountId: 'c1' }),
    );
    expect(res.cookies.some((c) => c.name === 'b2b_cart_merge_flash')).toBe(false);
  });

  it('hands an enrolled customer to the code screen in the starting language', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { exchange: res } = await signIn(h, '/en/account/orders');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        status: 'mfaRequired',
        challengeId: 'challenge-1',
        redirectPath: `/en/login/mfa?next=${encodeURIComponent('/en/account/orders')}`,
      },
    });
    expect(h.createSession).not.toHaveBeenCalled();
    for (const name of SIGN_IN_COOKIES) expect(res.cookies.some((c) => c.name === name)).toBe(false);
  });

  it('redeems a code once', async () => {
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    expect((await exchange(h, code, started.secret)).statusCode).toBe(200);
    expectHandoffRefused(await exchange(h, code, started.secret));
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired code', async () => {
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    // What Redis does when the sixty seconds are up.
    h.redis.store.delete(`mfa:oauth:handoff:${sha256(code)}`);
    expectHandoffRefused(await exchange(h, code, started.secret));
  });

  it('refuses a code never issued', async () => {
    expectHandoffRefused(await exchange(h, randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')));
  });

  it('refuses another browser’s binding, and the code is gone afterwards', async () => {
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    expectHandoffRefused(await exchange(h, code, randomBytes(32).toString('base64url')));
    expectHandoffRefused(await exchange(h, code, started.secret));
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('refuses a redemption asked on another sales channel', async () => {
    channel.current = { id: SPLIT_CHANNEL };
    const started = await start(h);
    const code = handoffCode(
      await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }),
      SPLIT_STOREFRONT,
    );
    channel.current = { id: 'another-channel' };
    expectHandoffRefused(await exchange(h, code, started.secret));
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('redeems on the started-on channel', async () => {
    channel.current = { id: SPLIT_CHANNEL };
    const started = await start(h);
    const code = handoffCode(
      await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }),
      SPLIT_STOREFRONT,
    );
    const res = await exchange(h, code, started.secret);
    expect(res.statusCode).toBe(200);
    expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
  });

  it('refuses a code whose account had its pending sign-ins withdrawn', async () => {
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    await h.challengeStore.invalidateSubject('customer', 'c1');
    expectHandoffRefused(await exchange(h, code, started.secret));
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('never logs the code, the binding secret, the challenge or the session', async () => {
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-secret-id' });
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    await exchange(h, code, randomBytes(32).toString('base64url'));
    const all = h.logs.join('\n');
    expect(all).toContain(sha256(code).slice(0, 8));
    for (const secret of [code, started.secret, 'challenge-secret-id', 'session-cookie']) {
      expect(all).not.toContain(secret);
    }
  });

  it.each([
    [{}],
    [{ code: 'short', binding: 'short' }],
    [{ code: 'A'.repeat(43), binding: 'B'.repeat(43), extra: true }],
  ])('refuses a malformed body (%o)', async (payload) => {
    const res = await h.app.inject({ method: 'POST', url: EXCHANGE, payload });
    expect(res.statusCode).toBe(400);
    expect(h.createSession).not.toHaveBeenCalled();
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
    const { exchange: res } = await signIn(h, '/account/orders');

    expect(res.json().data).toMatchObject({
      status: 'mfaRequired',
      challengeId: 'challenge-1',
      redirectPath: `/pl/login/mfa?next=${encodeURIComponent('/account/orders')}`,
    });
    expect(h.createSession).not.toHaveBeenCalled();
    expect(sessionCookie(res, 'b2b_session')).toBeUndefined();
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

  it('signs an administrator in directly when there is no second factor and none is enforced', async () => {
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
 * Issue #1279 — the step runs in the **exchange**, the storefront's
 * server-to-server call: that is the request that carries the storefront
 * host's `b2b_cart_anon` (the provider's redirect to the API host never could
 * on split hosts), and it runs on the channel the sign-in was **started** on.
 * The backend no longer writes the merge notice's flash cookie: the storefront
 * writes it from `cartMerge`, as after a password sign-in.
 */
describe('federated sign-in — the signed-out basket is carried over (#1188, #1279)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await build();
  });
  afterEach(async () => {
    await h.app.close();
  });

  const CART_ID = '4f0c8e8a-5b8e-4d4a-9a39-2f8d9d6f7a10';
  const MERGED: CustomerSignInCompletion = {
    cartMerge: { outcome: 'merged', destinationCartId: CART_ID },
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

  it('hands the exchange’s cookies and the started-on channel to the completion step', async () => {
    h.setCompletion(MERGED);
    const secret = randomBytes(32).toString('base64url');
    const binding = 'binding-1188';
    const state = await h.challengeStore.issueOAuthTransaction({
      surface: 'customer',
      provider: 'google',
      salesChannelId: 'channel-started-on',
      pkceVerifier: 'verifier',
      nonce: 'nonce',
      next: '/account/orders',
      language: null,
      browserBinding: sha256(binding),
      storefrontBindingDigest: sha256(secret),
    });
    const back = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding });
    // The callback is the provider's redirect to the API host: nothing merges there.
    expect(h.completions).toEqual([]);

    channel.current = { id: 'channel-started-on' };
    const res = await exchange(h, handoffCode(back), secret, {
      b2b_cart_anon: 'anon-1188',
      compare_token: 'cmp-1188',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      status: 'authenticated',
      redirectPath: '/account/orders',
      cartMerge: { outcome: 'merged', destinationCartId: CART_ID },
    });
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
    'a %s basket clears the anonymous cookie and answers the merge; the storefront writes the notice',
    async (outcome) => {
      h.setCompletion({ cartMerge: { outcome, destinationCartId: CART_ID }, clearAnonymousCartCookie: true });
      const { exchange: res } = await signIn(h, undefined, { b2b_cart_anon: 'anon-1188' });

      expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
      expect(anonCleared(res)).toBe(true);
      expect(res.json().data.cartMerge).toEqual({ outcome, destinationCartId: CART_ID });
      expect(res.cookies.some((c) => c.name === 'b2b_cart_merge_flash')).toBe(false);
    },
  );

  it('an emptied basket (noop) clears the anonymous cookie', async () => {
    h.setCompletion({ cartMerge: { outcome: 'noop', destinationCartId: CART_ID }, clearAnonymousCartCookie: true });
    const { exchange: res } = await signIn(h, undefined, { b2b_cart_anon: 'anon-1188' });

    expect(anonCleared(res)).toBe(true);
    expect(res.json().data.cartMerge).toEqual({ outcome: 'noop', destinationCartId: CART_ID });
  });

  it('nothing merged (no basket, a failed merge) keeps the anonymous cookie', async () => {
    const { exchange: res } = await signIn(h, undefined, { b2b_cart_anon: 'anon-1188' });

    expect(sessionCookie(res, 'b2b_session')?.value).toBe('session-cookie');
    expect(h.completions).toHaveLength(1);
    expect(res.cookies.some((c) => c.name === 'b2b_cart_anon')).toBe(false);
    expect(res.json().data.cartMerge).toBeNull();
  });

  it('a customer handed to the second step is not completed here — the code screen completes it', async () => {
    h.setCompletion(MERGED);
    h.setDecision({ kind: 'challenge', challengeId: 'challenge-1' });
    const { exchange: res } = await signIn(h, undefined, { b2b_cart_anon: 'anon-1188' });

    expect(h.completions).toEqual([]);
    expect(res.cookies.some((c) => c.name === 'b2b_cart_anon')).toBe(false);
  });

  it('a refused redemption is not completed', async () => {
    h.setCompletion(MERGED);
    const started = await start(h);
    const code = handoffCode(await callback(h, started.state, { [OAUTH_BINDING_COOKIE_NAME]: started.binding! }));
    await exchange(h, code, randomBytes(32).toString('base64url'), { b2b_cart_anon: 'anon-1188' });
    expect(h.completions).toEqual([]);
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
    const { exchange: res } = await signIn(h, '/en/account/orders');
    expect(res.json().data.redirectPath).toBe(`/en/login/mfa?next=${encodeURIComponent('/en/account/orders')}`);
  });

  it('returns a refused customer to the sign-in page in the starting language', async () => {
    h.setPermitted(false);
    const { state, binding } = await start(h, 'customer', '/en/cart');
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding! });
    expect(res.headers['location']).toBe(`${STOREFRONT}/en/login?error=sales_channel_not_permitted`);
  });

  it('passes next through unchanged on success', async () => {
    const { exchange: res } = await signIn(h, '/en/account');
    expect(res.json().data.redirectPath).toBe('/en/account');
  });

  /**
   * Issue #1011 — a `next` without a language prefix takes the language from the whole
   * `Accept-Language` through `requestScopeLanguage`: the tags in descending `q`, each
   * matched against the started-on channel's languages (exactly, then by base language),
   * else the channel's default. It used to be the header's first tag alone.
   */
  async function refusedFrom(acceptLanguage: string | undefined, next = '/cart'): Promise<string> {
    channel.current = { id: 'channel-1011', languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' };
    h.setPermitted(false);
    const secret = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({ next, binding: sha256(secret) });
    const started = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/start?${query.toString()}`,
      headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
    });
    expect(started.statusCode).toBe(302);
    const state = new URL(started.headers['location'] as string).searchParams.get('state')!;
    const binding = started.cookies.find((c) => c.name === OAUTH_BINDING_COOKIE_NAME)!.value;
    const res = await callback(h, state, { [OAUTH_BINDING_COOKIE_NAME]: binding });
    return String(res.headers['location']);
  }

  it('honours the q-weights of Accept-Language (#1011)', async () => {
    expect(await refusedFrom('pl;q=0.2, en-US;q=0.9')).toBe(`${STOREFRONT}/en/login?error=sales_channel_not_permitted`);
  });

  it('skips a tag the channel does not serve for the next one it does (#1011)', async () => {
    expect(await refusedFrom('de-DE, en;q=0.5')).toBe(`${STOREFRONT}/en/login?error=sales_channel_not_permitted`);
  });

  it('matches a language-only tag by base language, and falls back to the default (#1011)', async () => {
    expect(await refusedFrom('en')).toBe(`${STOREFRONT}/en/login?error=sales_channel_not_permitted`);
    expect(await refusedFrom('de-DE')).toBe(`${STOREFRONT}/pl/login?error=sales_channel_not_permitted`);
    expect(await refusedFrom(undefined)).toBe(`${STOREFRONT}/pl/login?error=sales_channel_not_permitted`);
  });

  it('a prefixed next still wins over Accept-Language (#1011)', async () => {
    expect(await refusedFrom('en-US', '/pl/cart')).toBe(`${STOREFRONT}/pl/login?error=sales_channel_not_permitted`);
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
    const literals = [...source.matchAll(/loginRedirect\(\s*base,\s*surface,\s*'([^']*)'/g)].map((m) => m[1]!);
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
