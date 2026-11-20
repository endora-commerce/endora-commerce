import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';

/**
 * `specs/182-related-payers/` FR-002 — where the capability is off on the request's channel the
 * account behaves as if `related_payers` were absent, although the module is present: no
 * *Payers* and no *Orders we pay for* entry, and the *Payers* page answers not-found instead of
 * rendering a request form whose every submission the API refuses with `404` (owner's manual
 * test, 2026-11-20). One read decides it, made only when an entry would otherwise be offered.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/account',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

let absent: string[] = [];
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US', salesChannelCode: 'pl_retail' },
    modules: { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));

const me = {
  customerAccount: {
    id: 'acc-1',
    organizationId: 'org-1',
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
    organizationRole: { id: 'r1', kind: 'administrator', name: 'Administrator' },
    permissions: [],
    emailVerifiedAt: null,
    twoFactorEnabled: false,
  },
  organization: { id: 'org-1', name: 'Acme', isPersonal: false },
  impersonation: null,
} as unknown as MeResult;
vi.mock('../../lib/api/account', () => ({ getMe: async () => me }));
vi.mock('../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));
vi.mock('../../lib/api/cart', () => ({ listOrganizationCarts: async () => ({ meta: { totalCount: 0 } }) }));
vi.mock('../../lib/api/customer-notifications', () => ({ getUnreadNotificationCount: async () => 0 }));

let enabled = true;
const reads: string[] = [];
vi.mock('../../lib/api/related-payers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/related-payers')>();
  const list = (name: string) => async () => {
    reads.push(name);
    return [];
  };
  return {
    ...actual,
    getRelatedPayersAvailability: async () => {
      reads.push('availability');
      return enabled;
    },
    listPayerLinks: list('links'),
    listSentPayerRequests: list('sent'),
    listIncomingPayerRequests: list('incoming'),
    listPayees: list('payees'),
    listPayeeInvitations: async () => {
      reads.push('invitations');
      return null;
    },
  };
});

const { default: AccountLayout } = await import('../../app/(account)/layout');
const { default: PayersPage } = await import('../../app/(account)/payers/page');

async function nav(): Promise<string> {
  const html = renderToString(<>{(await AccountLayout({ children: null })) as ReactNode}</>);
  return html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
}

beforeEach(() => {
  absent = [];
  enabled = true;
  reads.length = 0;
});

describe('related payers off on the channel — the account (FR-002)', () => {
  it('offers Payers and Orders we pay for while the capability is on for the channel', async () => {
    const html = await nav();
    expect(html).toContain('href="/payers"');
    expect(html).toContain('href="/paid-orders"');
    expect(reads).toEqual(['availability']);
  });

  it('offers neither entry while it is off on the channel, the module present', async () => {
    enabled = false;
    const html = await nav();
    expect(html).not.toContain('href="/payers"');
    expect(html).not.toContain('href="/paid-orders"');
    // The rest of the navigation is untouched.
    expect(html).toContain('href="/orders"');
  });

  it('reads nothing while the module is off', async () => {
    absent = ['related_payers'];
    const html = await nav();
    expect(html).not.toContain('href="/payers"');
    expect(reads).toEqual([]);
  });

  it('the Payers page answers not-found, with no form and no list read, while it is off on the channel', async () => {
    enabled = false;
    await expect(PayersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(reads).toEqual(['availability']);
  });

  it('the Payers page renders its request form while it is on', async () => {
    const html = renderToString(<>{(await PayersPage({ searchParams: Promise.resolve({}) })) as ReactNode}</>);
    expect(html).toContain('Ask a company to pay for our orders');
  });
});

describe('getRelatedPayersAvailability', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function read(response: () => Promise<Response>): Promise<boolean> {
    globalThis.fetch = vi.fn(response) as unknown as typeof fetch;
    const actual = await vi.importActual<typeof import('../../lib/api/related-payers')>('../../lib/api/related-payers');
    return actual.getRelatedPayersAvailability('session-cookie', { salesChannelCode: 'pl_retail' });
  }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks the channel, as the signed-in customer, and answers its flag', async () => {
    expect(await read(async () => json(200, { data: { enabled: true } }))).toBe(true);
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toMatch(/\/api\/v1\/related-payers\/availability$/);
    expect((init.headers as Record<string, string>)['Cookie']).toBe('b2b_session=session-cookie');
    expect(await read(async () => json(200, { data: { enabled: false } }))).toBe(false);
  });

  it('answers off when the module is off, the answer is malformed or the API cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await read(async () => json(503, { error: { code: 'MODULE_DISABLED', message: 'off' } }))).toBe(false);
    expect(await read(async () => json(200, { data: { enabled: 'yes' } }))).toBe(false);
    expect(
      await read(async () => {
        throw new Error('ECONNREFUSED');
      }),
    ).toBe(false);
  });
});
