import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionsOf, form, redirectOf } from '../url-errors/actions';

/**
 * Issue #358 — signing in on the storefront keeps the basket filled while
 * signed out.
 *
 * The storefront signs a shopper in from a server action, so the browser never
 * talks to the backend on that call: the backend's merge at sign-in
 * (`specs/154-sales-channel-access/contracts/basket-attribution.md` §3) sees the
 * anonymous basket only if the storefront forwards `b2b_cart_anon`. It forwarded
 * the known-device cookie alone, so the backend never merged anything.
 *
 * The header is built from an allow-list: the session, the comparison token, the
 * second-step challenge and anything else the browser holds stay behind.
 *
 * The second half drives the sign-in page's action over the real `lib/api/auth`
 * and `lib/session`, with only the cookie jar and the network stubbed: the
 * cookie goes out, and an `adopted` / `merged` answer drops the drained
 * anonymous cookie and leaves the flash the next page shows its notice from.
 */

const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale: 'en-US' },
    modules: { isPresent: () => false },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  localizedPath: async (to: string) => to,
}));
vi.mock('../../lib/i18n/localized-link', () => ({
  LocalizedLink: () => null,
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../components/SocialLoginButtons', () => ({ SocialLoginButtons: () => null }));

const { loginCustomer } = await import('../../lib/api/auth');
const { default: LoginPage } = await import('../../app/(auth)/login/page');

const DEVICE = 'b2b_customer_device';
const ANON = 'b2b_cart_anon';
/** A signed value as `@fastify/cookie` writes it: the signature may hold `+` and `/`. */
const SIGNED = 'v1.c-1.0a1b.2c3d.ab+cd/ef';
const ANON_TOKEN = 'anon-7f3c2a9e-4b1d-4e8a-9c6f-2d5b8e1a0c3f';
const CART_ID = '4f0c8e8a-5b8e-4d4a-9a39-2f8d9d6f7a10';

const originalFetch = globalThis.fetch;

interface Recorded {
  url: string;
  cookie: string | null;
}

function stubFetch(answer: { body: unknown; setCookie?: string[] }): Recorded[] {
  const seen: Recorded[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const value of answer.setCookie ?? []) headers.append('set-cookie', value);
    return new Response(JSON.stringify(answer.body), { status: 200, headers });
  }) as unknown as typeof fetch;
  return seen;
}

const MFA_REQUIRED = { body: { data: { status: 'mfaRequired', challengeId: 'ch-1' } } };

beforeEach(() => {
  jar.clear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the sign-in call carries the signed-out basket', () => {
  it('forwards b2b_cart_anon beside the known-device cookie', async () => {
    jar.set(DEVICE, SIGNED);
    jar.set(ANON, ANON_TOKEN);
    const seen = stubFetch(MFA_REQUIRED);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/login$/);
    expect(seen[0]!.cookie).toBe(
      `${DEVICE}=${encodeURIComponent(SIGNED)}; ${ANON}=${ANON_TOKEN}`,
    );
  });

  it('forwards b2b_cart_anon when the browser has no known-device cookie yet', async () => {
    jar.set(ANON, ANON_TOKEN);
    const seen = stubFetch(MFA_REQUIRED);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}`);
  });

  it('forwards only the allow-listed cookies, whatever else the browser holds', async () => {
    jar.set('b2b_session', 'stale-session');
    jar.set('compare_token', 'cmp');
    jar.set('b2b_cart_merge_flash', 'adopted');
    jar.set('b2b_mfa_challenge', 'ch-0');
    jar.set('_ga', 'GA1.1.123');
    jar.set(`${ANON}_other`, 'lookalike');
    jar.set(ANON, ANON_TOKEN);
    jar.set(DEVICE, SIGNED);
    const seen = stubFetch(MFA_REQUIRED);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    const names = seen[0]!.cookie!.split('; ').map((pair) => pair.split('=')[0]);
    expect(names.sort()).toEqual([ANON, DEVICE].sort());
  });

  it('sends no cookie when the browser holds neither', async () => {
    jar.set('b2b_session', 'stale-session');
    const seen = stubFetch(MFA_REQUIRED);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBeNull();
  });
});

async function signIn(): Promise<string> {
  const tree = await LoginPage({ searchParams: Promise.resolve({ next: '/cart' }) });
  const action = actionsOf(tree).get('loginAction')!;
  return redirectOf(() =>
    action(form({ email: 'buyer@example.test', password: 'secret', next: '/cart' }) as never),
  );
}

describe('the sign-in page, end to end over the real auth and session helpers', () => {
  it.each(['adopted', 'merged'] as const)(
    'a %s basket: the cookie went out, the drained anonymous cookie is dropped and the notice is flashed',
    async (outcome) => {
      jar.set(ANON, ANON_TOKEN);
      const seen = stubFetch({
        body: {
          data: { status: 'authenticated', cartMerge: { outcome, destinationCartId: CART_ID } },
        },
        setCookie: ['b2b_session=s.tok; Path=/; HttpOnly', `${ANON}=; Max-Age=0; Path=/`],
      });

      expect(await signIn()).toBe('/cart');

      expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}`);
      expect(jar.get('b2b_session')).toBe('s.tok');
      expect(jar.has(ANON)).toBe(false);
      expect(jar.get('b2b_cart_merge_flash')).toBe(outcome);
    },
  );

  it('a noop merge flashes nothing', async () => {
    jar.set(ANON, ANON_TOKEN);
    stubFetch({
      body: {
        data: { status: 'authenticated', cartMerge: { outcome: 'noop', destinationCartId: CART_ID } },
      },
      setCookie: ['b2b_session=s.tok; Path=/; HttpOnly'],
    });

    expect(await signIn()).toBe('/cart');

    expect(jar.has('b2b_cart_merge_flash')).toBe(false);
  });
});
