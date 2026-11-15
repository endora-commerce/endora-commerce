import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isDocumentPath } from '../../lib/seo/robots-directive';

/**
 * Issue #1279 — federated (Google / Microsoft) customer sign-in on a storefront
 * whose API is served from another host.
 *
 * The storefront both starts and finishes the flow on its own host:
 *
 *  - `GET /auth/federated/start` binds the attempt to this browser with a
 *    secret in a cookie scoped to `/auth/federated`, and sends the browser to
 *    the API's OAuth `start` with the digest of that secret;
 *  - `GET /auth/federated/complete?code=` is where the API's callback sends the
 *    browser back. It redeems the code server-to-server with the secret, then
 *    sets the session (or the second-step challenge), the basket-merge notice
 *    and the drained-basket cleanup itself, as the password sign-in does.
 *
 * Only the cookie jar and the network are stubbed; `lib/session` and the
 * transport are the real ones.
 */

interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  maxAge?: number;
}
const jar = new Map<string, { value: string; options: CookieOptions }>();
const deleted: Array<string | { name: string; path?: string }> = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    getAll: () => [...jar].map(([name, { value }]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, options: CookieOptions = {}) => {
      jar.set(name, { value, options });
    },
    delete: (arg: string | { name: string; path?: string }) => {
      deleted.push(arg);
      jar.delete(typeof arg === 'string' ? arg : arg.name);
    },
  }),
  headers: async () => new Headers(),
}));

const { GET: start } = await import('../../app/auth/federated/start/route');
const { GET: complete } = await import('../../app/auth/federated/complete/route');

const BINDING = 'b2b_federated_binding';
const SECRET = 'S'.repeat(43);
const CODE = 'C'.repeat(43);
const CART_ID = '4f0c8e8a-5b8e-4d4a-9a39-2f8d9d6f7a10';
const originalFetch = globalThis.fetch;

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://shop.example.com${path}`, { headers });
}

interface Recorded {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: unknown;
}

function stubFetch(answer: { status?: number; body: unknown; setCookie?: string[] } | Error): Recorded[] {
  const seen: Recorded[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (answer instanceof Error) throw answer;
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const value of answer.setCookie ?? []) headers.append('set-cookie', value);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return seen;
}

function locationOf(res: Response): string {
  expect(res.status).toBe(303);
  return res.headers.get('location')!;
}

function expectPrivate(res: Response): void {
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-robots-tag')).toContain('noindex');
}

beforeEach(() => {
  jar.clear();
  deleted.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GET /auth/federated/start', () => {
  it('binds the attempt to this browser and sends it to the API’s start with the digest', async () => {
    const res = await start(get('/auth/federated/start?provider=google&next=%2Fen%2Faccount%2Forders', { 'x-sales-channel': 'trade eu' }));

    const target = new URL(locationOf(res));
    expect(`${target.origin}${target.pathname}`).toBe('http://api.test/api/v1/auth/customer/oauth/google/start');
    expect(target.searchParams.get('next')).toBe('/en/account/orders');
    expect(target.searchParams.get('salesChannel')).toBe('trade eu');

    const cookie = jar.get(BINDING);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/auth/federated', maxAge: 600 });
    expect(target.searchParams.get('binding')).toBe(createHash('sha256').update(cookie!.value).digest('hex'));
    expectPrivate(res);
  });

  it('a fresh secret every time', async () => {
    await start(get('/auth/federated/start?provider=google'));
    const first = jar.get(BINDING)!.value;
    await start(get('/auth/federated/start?provider=microsoft'));
    expect(jar.get(BINDING)!.value).not.toBe(first);
  });

  it('names no channel the request did not carry', async () => {
    const target = new URL(locationOf(await start(get('/auth/federated/start?provider=microsoft'))));
    expect(target.pathname).toBe('/api/v1/auth/customer/oauth/microsoft/start');
    expect(target.searchParams.has('salesChannel')).toBe(false);
    expect(target.searchParams.get('next')).toBe('/account');
  });

  it.each(['https://evil.test/x', '//evil.test/x', 'account'])('keeps an unsafe next (%s) on the shop', async (next) => {
    const target = new URL(locationOf(await start(get(`/auth/federated/start?provider=google&next=${encodeURIComponent(next)}`))));
    expect(target.searchParams.get('next')).toBe('/account');
  });

  it('refuses a provider the platform does not support, without a cookie', async () => {
    const res = await start(get('/auth/federated/start?provider=yahoo'));
    expect(new URL(locationOf(res)).pathname + new URL(locationOf(res)).search).toBe('/login?error=unknown_provider');
    expect(new URL(locationOf(res)).origin).toBe('https://shop.example.com');
    expect(jar.has(BINDING)).toBe(false);
    expectPrivate(res);
  });
});

describe('GET /auth/federated/complete', () => {
  beforeEach(() => {
    jar.set(BINDING, { value: SECRET, options: {} });
    jar.set('b2b_cart_anon', { value: 'anon-1', options: {} });
  });

  const bindingDeleted = () =>
    deleted.some((arg) => typeof arg === 'object' && arg.name === BINDING && arg.path === '/auth/federated');

  it('redeems the code server-to-server with the browser’s binding and its sign-in cookies', async () => {
    const seen = stubFetch({
      body: { data: { status: 'authenticated', redirectPath: '/en/account', cartMerge: null } },
      setCookie: ['b2b_session=sess-1; Path=/; HttpOnly; SameSite=Lax'],
    });
    await complete(
      get(`/auth/federated/complete?code=${CODE}`, {
        'x-sales-channel': 'trade',
        'x-forwarded-for': '203.0.113.7',
        'user-agent': 'Browser/1.0',
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('http://api.test/api/v1/auth/customer/oauth/exchange');
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.body).toEqual({ code: CODE, binding: SECRET });
    expect(seen[0]!.headers.get('x-sales-channel')).toBe('trade');
    expect(seen[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(seen[0]!.headers.get('user-agent')).toBe('Browser/1.0');
    // The allow-list the password sign-in forwards — never the binding itself.
    expect(seen[0]!.headers.get('cookie')).toBe('b2b_cart_anon=anon-1');
  });

  it('signs the browser in on this host and sends it where the sign-in started', async () => {
    stubFetch({
      body: { data: { status: 'authenticated', redirectPath: '/en/account/orders', cartMerge: null } },
      setCookie: ['b2b_session=sess-1; Path=/; HttpOnly; SameSite=Lax'],
    });
    const res = await complete(get(`/auth/federated/complete?code=${CODE}`));

    expect(locationOf(res)).toBe('https://shop.example.com/en/account/orders');
    expect(jar.get('b2b_session')?.value).toBe('sess-1');
    expect(jar.get('b2b_session')?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(bindingDeleted()).toBe(true);
    // Nothing merged: the basket cookie stays and no notice is left.
    expect(jar.has('b2b_cart_anon')).toBe(true);
    expect(jar.has('b2b_cart_merge_flash')).toBe(false);
    expectPrivate(res);
  });

  it.each(['merged', 'adopted'] as const)(
    'a %s basket leaves the notice and drops the drained basket cookie, as the password sign-in does',
    async (outcome) => {
      stubFetch({
        body: { data: { status: 'authenticated', redirectPath: '/account', cartMerge: { outcome, destinationCartId: CART_ID } } },
        setCookie: ['b2b_session=sess-1; Path=/; HttpOnly'],
      });
      await complete(get(`/auth/federated/complete?code=${CODE}`));

      expect(jar.get('b2b_cart_merge_flash')?.value).toBe(outcome);
      expect(jar.has('b2b_cart_anon')).toBe(false);
    },
  );

  it('hands an enrolled customer to the code screen with the challenge in its cookie', async () => {
    stubFetch({
      body: { data: { status: 'mfaRequired', challengeId: 'challenge-1', redirectPath: '/pl/login/mfa?next=%2Fpl%2Faccount' } },
    });
    const res = await complete(get(`/auth/federated/complete?code=${CODE}`));

    expect(locationOf(res)).toBe('https://shop.example.com/pl/login/mfa?next=%2Fpl%2Faccount');
    expect(jar.get('b2b_mfa_challenge')?.value).toBe('challenge-1');
    expect(jar.has('b2b_session')).toBe(false);
    expect(bindingDeleted()).toBe(true);
  });

  it('never redirects off the shop, whatever the answer says', async () => {
    stubFetch({
      body: { data: { status: 'authenticated', redirectPath: '//evil.test/x', cartMerge: null } },
      setCookie: ['b2b_session=sess-1; Path=/'],
    });
    expect(locationOf(await complete(get(`/auth/federated/complete?code=${CODE}`)))).toBe(
      'https://shop.example.com/account',
    );
  });

  it('a browser without the binding cookie is not signed in, and the backend is not asked', async () => {
    jar.delete(BINDING);
    const seen = stubFetch({ body: {} });
    const res = await complete(get(`/auth/federated/complete?code=${CODE}`));
    expect(locationOf(res)).toBe('https://shop.example.com/login?error=sign_in_expired');
    expect(seen).toEqual([]);
    expectPrivate(res);
  });

  it('a request without a code is refused and the binding dropped', async () => {
    stubFetch({ body: {} });
    const res = await complete(get('/auth/federated/complete'));
    expect(locationOf(res)).toBe('https://shop.example.com/login?error=sign_in_expired');
    expect(bindingDeleted()).toBe(true);
  });

  it('a refused code reads as an expired sign-in', async () => {
    stubFetch({ status: 400, body: { error: { code: 'MFA_FEDERATED_HANDOFF_INVALID', message: 'x' } } });
    const res = await complete(get(`/auth/federated/complete?code=${CODE}`));
    expect(locationOf(res)).toBe('https://shop.example.com/login?error=sign_in_expired');
    expect(jar.has('b2b_session')).toBe(false);
    expect(bindingDeleted()).toBe(true);
    expectPrivate(res);
  });

  it.each([
    ['the module switched off', { status: 503, body: { error: { code: 'MODULE_DISABLED', message: 'x' } } }],
    ['a network failure', new Error('connect ECONNREFUSED')],
  ] as const)('%s reads as a failed sign-in', async (_label, answer) => {
    stubFetch(answer);
    const res = await complete(get(`/auth/federated/complete?code=${CODE}`));
    expect(locationOf(res)).toBe('https://shop.example.com/login?error=sign_in_failed');
    expect(jar.has('b2b_session')).toBe(false);
    expect(bindingDeleted()).toBe(true);
  });
});

describe('the middleware leaves both routes alone', () => {
  it.each(['/auth/federated/start', '/auth/federated/complete'])(
    '%s is not a document: no language prefix, no closed-store redirect, no outage page',
    (pathname) => {
      expect(isDocumentPath(pathname)).toBe(false);
    },
  );

  it('and nothing near them changes', () => {
    for (const pathname of ['/auth/email-verification', '/auth/federated', '/auth/federated/start/x', '/en/auth/federated/start']) {
      expect(isDocumentPath(pathname), pathname).toBe(true);
    }
  });
});
