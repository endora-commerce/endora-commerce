import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The customer known-device cookie is carried through the storefront.
 *
 * The storefront signs a shopper in from a server action, so the browser never
 * talks to the backend on these routes: the cookie the backend sets on a
 * completed sign-in has to be stored on the storefront origin, and forwarded
 * with the next sign-in, second step and reset request. Without it every
 * attempt reaches the backend as one from a device the account has never been
 * used on, and is held to the account-wide budget a stranger can fill.
 */

const jar = new Map<string, string>();
const setCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      setCalls.push({ name, value, options });
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const { loginCustomer, verifyCustomerMfa, requestPasswordReset } = await import(
  '../../lib/api/auth'
);
const { completeMfaSetupTicket } = await import('../../lib/api/mfa');
const { pickKnownDeviceCookie } = await import('../../lib/session');

const DEVICE = 'b2b_customer_device';
/** A signed value as `@fastify/cookie` writes it: the signature may hold `+` and `/`. */
const SIGNED = 'v1.c-1.0a1b.2c3d.ab+cd/ef';
const SET_DEVICE = `${DEVICE}=${encodeURIComponent(SIGNED)}; Max-Age=7776000; Path=/; HttpOnly; SameSite=Lax`;

const originalFetch = globalThis.fetch;

interface Recorded {
  url: string;
  cookie: string | null;
}

function stubFetch(answer: { status?: number; body: unknown; setCookie?: string[] }): Recorded[] {
  const seen: Recorded[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const value of answer.setCookie ?? []) headers.append('set-cookie', value);
    const status = answer.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(answer.body), { status, headers });
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(() => {
  jar.clear();
  setCalls.length = 0;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sign-in', () => {
  it('forwards the browser known-device cookie to the backend', async () => {
    jar.set(DEVICE, SIGNED);
    const seen = stubFetch({
      body: { data: { status: 'mfaRequired', challengeId: 'ch-1' } },
    });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/login$/);
    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}`);
  });

  it('sends no cookie when the browser has none', async () => {
    const seen = stubFetch({
      body: { data: { status: 'mfaRequired', challengeId: 'ch-1' } },
    });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBeNull();
  });

  it('stores the cookie a completed sign-in sets, decoded, with the lifetime the backend gave it', async () => {
    stubFetch({
      body: { data: { status: 'authenticated' } },
      setCookie: ['b2b_session=s.tok; Path=/; HttpOnly', SET_DEVICE],
    });

    const result = await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(result).toMatchObject({ status: 'authenticated', sessionCookieValue: 's.tok' });
    expect(setCalls).toEqual([
      {
        name: DEVICE,
        value: SIGNED,
        options: expect.objectContaining({ httpOnly: true, path: '/', maxAge: 7776000 }),
      },
    ]);
  });

  it('round-trips: the stored value is forwarded byte for byte on the next sign-in', async () => {
    stubFetch({ body: { data: { status: 'authenticated' } }, setCookie: [SET_DEVICE] });
    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    const seen = stubFetch({ body: { data: { status: 'mfaRequired', challengeId: 'ch-1' } } });
    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBe(SET_DEVICE.split(';')[0]);
  });
});

describe('second step', () => {
  it('forwards the cookie with the code and stores the one the completed sign-in sets', async () => {
    jar.set(DEVICE, 'v1.c-1.old.stamp');
    const seen = stubFetch({
      body: { data: { status: 'authenticated' } },
      setCookie: ['b2b_session=s.tok; Path=/', SET_DEVICE],
    });

    await expect(verifyCustomerMfa({ challengeId: 'ch-1', code: '123456' })).resolves.toEqual({
      sessionCookieValue: 's.tok',
      // Issue #368 — no basket was carried, so the backend answered no merge.
      cartMerge: null,
    });

    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent('v1.c-1.old.stamp')}`);
    expect(jar.get(DEVICE)).toBe(SIGNED);
  });

  it('stores the cookie set when an enforced enrolment completes the sign-in', async () => {
    stubFetch({
      body: { data: { status: 'authenticated', recoveryCodes: ['a'] } },
      setCookie: ['b2b_session=s.tok; Path=/', SET_DEVICE],
    });

    await completeMfaSetupTicket('ticket', '123456');

    expect(jar.get(DEVICE)).toBe(SIGNED);
  });
});

describe('password reset request', () => {
  it('forwards the cookie', async () => {
    jar.set(DEVICE, SIGNED);
    const seen = stubFetch({ status: 204, body: null });

    await requestPasswordReset('buyer@example.test');

    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}`);
  });
});

describe('pickKnownDeviceCookie', () => {
  it('ignores other cookies and a cookie whose name only starts the same way', () => {
    expect(
      pickKnownDeviceCookie([`${DEVICE}_other=x; Path=/`, 'b2b_session=s; Path=/']),
    ).toBeNull();
  });

  it('answers the value without a lifetime when the header gives none', () => {
    expect(pickKnownDeviceCookie([`${DEVICE}=abc; Path=/`])).toEqual({ value: 'abc' });
  });
});
