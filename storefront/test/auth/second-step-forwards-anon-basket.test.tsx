import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actionsOf, form, redirectOf } from '../url-errors/actions';

/**
 * Issue #368 — a sign-in completed by a second step keeps the basket filled
 * while signed out.
 *
 * When the account needs two-step verification the password call answers
 * `mfaRequired` / `mfaSetupRequired` and the session is established by the
 * second call: the code verify, or the enforced-enrolment completion. That is
 * where the backend now merges the anonymous basket, so that call has to carry
 * `b2b_cart_anon` too (issue #358 made the password call carry it), and the
 * page has to drop the drained cookie and flash the notice exactly as the
 * password step's page does.
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

const { verifyCustomerMfa } = await import('../../lib/api/auth');
const { completeMfaSetupTicket } = await import('../../lib/api/mfa');
const { default: MfaPage } = await import('../../app/(auth)/login/mfa/page');
const { default: SetupPage } = await import('../../app/(auth)/login/setup/page');

const DEVICE = 'b2b_customer_device';
const ANON = 'b2b_cart_anon';
const COMPARE = 'compare_token';
const COMPARE_TOKEN = 'Xk3_pQ9-aB7cD2eF4gH6iJ';
const CHALLENGE = 'b2b_mfa_challenge';
const SETUP_TICKET = 'b2b_mfa_setup_ticket';
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

const AUTHENTICATED = {
  body: { data: { status: 'authenticated', recoveryCodes: ['r-1'] } },
  setCookie: ['b2b_session=s.tok; Path=/; HttpOnly'],
};

beforeEach(() => {
  jar.clear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the second-step calls carry the signed-out basket', () => {
  it('the code verify forwards b2b_cart_anon beside the known-device cookie', async () => {
    jar.set(DEVICE, SIGNED);
    jar.set(ANON, ANON_TOKEN);
    jar.set('b2b_session', 'stale-session');
    jar.set(CHALLENGE, 'ch-1');
    const seen = stubFetch(AUTHENTICATED);

    await verifyCustomerMfa({ challengeId: 'ch-1', code: '123456' });

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/mfa\/verify$/);
    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}; ${ANON}=${ANON_TOKEN}`);
  });

  it('the enforced-enrolment completion forwards b2b_cart_anon and nothing else', async () => {
    jar.set(ANON, ANON_TOKEN);
    jar.set('b2b_session', 'stale-session');
    jar.set(SETUP_TICKET, '{}');
    const seen = stubFetch(AUTHENTICATED);

    await completeMfaSetupTicket('ticket-1', '123456');

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/mfa\/setup-ticket\/complete$/);
    expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}`);
  });
});

// Issue #1189 — the call that establishes the session carries the signed-out comparison too, so
// the backend's post-sign-in step carries it over on both two-step paths.
describe('the second-step calls carry the signed-out comparison', () => {
  it('the code verify forwards compare_token beside the basket', async () => {
    jar.set(ANON, ANON_TOKEN);
    jar.set(COMPARE, COMPARE_TOKEN);
    jar.set(CHALLENGE, 'ch-1');
    const seen = stubFetch(AUTHENTICATED);

    await verifyCustomerMfa({ challengeId: 'ch-1', code: '123456' });

    expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}; ${COMPARE}=${COMPARE_TOKEN}`);
  });

  it('the enforced-enrolment completion forwards compare_token', async () => {
    jar.set(COMPARE, COMPARE_TOKEN);
    jar.set(SETUP_TICKET, '{}');
    const seen = stubFetch(AUTHENTICATED);

    await completeMfaSetupTicket('ticket-1', '123456');

    expect(seen[0]!.cookie).toBe(`${COMPARE}=${COMPARE_TOKEN}`);
  });
});

function merged(outcome: 'adopted' | 'merged' | 'noop') {
  return {
    body: {
      data: {
        status: 'authenticated',
        recoveryCodes: ['r-1'],
        cartMerge: { outcome, destinationCartId: CART_ID },
      },
    },
    setCookie: ['b2b_session=s.tok; Path=/; HttpOnly', `${ANON}=; Max-Age=0; Path=/`],
  };
}

async function verifyStep(): Promise<string> {
  const tree = await MfaPage({ searchParams: Promise.resolve({ next: '/cart' }) });
  const action = actionsOf(tree).get('verifyAction')!;
  return redirectOf(() => action(form({ code: '123456', next: '/cart' }) as never));
}

async function setupStep(): Promise<string> {
  const tree = await SetupPage({ searchParams: Promise.resolve({ next: '/cart' }) });
  const action = actionsOf(tree).get('completeAction')!;
  return redirectOf(() => action(form({ code: '123456', next: '/cart' }) as never));
}

describe('the second-step pages, end to end over the real auth and session helpers', () => {
  it.each(['adopted', 'merged'] as const)(
    'the code verify: a %s basket drops the drained anonymous cookie and flashes the notice',
    async (outcome) => {
      jar.set(ANON, ANON_TOKEN);
      jar.set(CHALLENGE, 'ch-1');
      const seen = stubFetch(merged(outcome));

      expect(await verifyStep()).toBe('/cart');

      expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}`);
      expect(jar.get('b2b_session')).toBe('s.tok');
      expect(jar.has(ANON)).toBe(false);
      expect(jar.get('b2b_cart_merge_flash')).toBe(outcome);
    },
  );

  it.each(['adopted', 'merged'] as const)(
    'the enforced enrolment: a %s basket drops the drained anonymous cookie and flashes the notice',
    async (outcome) => {
      jar.set(ANON, ANON_TOKEN);
      jar.set(SETUP_TICKET, JSON.stringify({ setupTicket: 'ticket-1', secret: 'S', otpauthUri: 'otpauth://x' }));
      const seen = stubFetch(merged(outcome));

      expect(await setupStep()).toBe('/account/security');

      expect(seen[0]!.cookie).toBe(`${ANON}=${ANON_TOKEN}`);
      expect(jar.get('b2b_session')).toBe('s.tok');
      expect(jar.has(ANON)).toBe(false);
      expect(jar.get('b2b_cart_merge_flash')).toBe(outcome);
    },
  );

  it('the code verify page sends the signed-out comparison and keeps its cookie', async () => {
    jar.set(COMPARE, COMPARE_TOKEN);
    jar.set(CHALLENGE, 'ch-1');
    const seen = stubFetch(AUTHENTICATED);

    expect(await verifyStep()).toBe('/cart');

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/mfa\/verify$/);
    expect(seen[0]!.cookie).toBe(`${COMPARE}=${COMPARE_TOKEN}`);
    expect(jar.get(COMPARE)).toBe(COMPARE_TOKEN);
  });

  it('the enforced-enrolment page sends the signed-out comparison and keeps its cookie', async () => {
    jar.set(COMPARE, COMPARE_TOKEN);
    jar.set(SETUP_TICKET, JSON.stringify({ setupTicket: 'ticket-1', secret: 'S', otpauthUri: 'otpauth://x' }));
    const seen = stubFetch(AUTHENTICATED);

    expect(await setupStep()).toBe('/account/security');

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/mfa\/setup-ticket\/complete$/);
    expect(seen[0]!.cookie).toBe(`${COMPARE}=${COMPARE_TOKEN}`);
    expect(jar.get(COMPARE)).toBe(COMPARE_TOKEN);
  });

  it('a noop merge keeps the anonymous cookie and flashes nothing', async () => {
    jar.set(ANON, ANON_TOKEN);
    jar.set(CHALLENGE, 'ch-1');
    stubFetch(merged('noop'));

    expect(await verifyStep()).toBe('/cart');

    expect(jar.has(ANON)).toBe(true);
    expect(jar.has('b2b_cart_merge_flash')).toBe(false);
  });
});
