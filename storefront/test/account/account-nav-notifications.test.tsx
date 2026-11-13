import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';

/**
 * `specs/179-rfq-and-customer-notifications/` T083 — the account area leads on
 * to the centre (FR-051c, SC-006). The sidebar lists *Notifications* second,
 * after the profile, with the unread count in text when there is any; the
 * overview shows a one-line summary linking to the page when something is
 * unread. Neither appears while `customer_notifications` is off, and nothing
 * is read for it then.
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

let locale = 'en-US';
let absent: string[] = [];
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    ctx: { locale },
    modules: { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent },
  }),
}));

const me = {
  customerAccount: {
    id: 'acc-1',
    organizationId: 'org-1',
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
    organizationRole: { id: 'r1', kind: 'member', name: 'Member' },
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
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/organization', () => ({ getMyRole: async () => null }));
vi.mock('../../lib/api/pwa-server', () => ({
  fetchPwaConfig: async () => ({ pushEnabled: false }),
  getPushPreferences: async () => null,
  updatePushPreferences: async () => undefined,
}));

let unread = 3;
let countReads = 0;
vi.mock('../../lib/api/customer-notifications', () => ({
  getUnreadNotificationCount: async () => {
    countReads++;
    return unread;
  },
}));

const { default: AccountLayout } = await import('../../app/(account)/layout');
const { default: AccountProfilePage } = await import('../../app/(account)/account/page');

async function nav(): Promise<string> {
  const html = renderToString(<>{(await AccountLayout({ children: null })) as ReactNode}</>);
  return html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
}

async function overview(): Promise<string> {
  return renderToString(<>{(await AccountProfilePage({ searchParams: Promise.resolve({}) })) as ReactNode}</>);
}

/** The visible link texts of the sidebar, in order. */
function links(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*>(.*?)<\/a>/g)].map((m) => m[1]!.replace(/<!-- -->/g, ''));
}

beforeEach(() => {
  locale = 'en-US';
  absent = [];
  unread = 3;
  countReads = 0;
});

describe('account sidebar', () => {
  it('lists Notifications second, after the profile, with the count when unread', async () => {
    const html = await nav();
    expect(links(html).slice(0, 2)).toEqual(['Profile', 'Notifications (3)']);
    expect(html).toContain('href="/account/notifications"');
  });

  it('shows the plain label when nothing is unread', async () => {
    unread = 0;
    expect(links(await nav())[1]).toBe('Notifications');
  });

  it('is in Polish for a Polish buyer', async () => {
    locale = 'pl-PL';
    expect(links(await nav())[1]).toBe('Powiadomienia (3)');
  });

  it('leaves the entry out, and reads nothing, while the module is off', async () => {
    absent = ['customer_notifications'];
    const html = await nav();
    expect(html).not.toContain('/account/notifications');
    expect(countReads).toBe(0);
  });
});

describe('account overview summary', () => {
  it('says how many are unread and links to the page', async () => {
    const html = await overview();
    expect(html).toContain('href="/account/notifications"');
    expect(html).toContain('You have 3 unread notifications');
  });

  it('is in Polish for a Polish buyer', async () => {
    locale = 'pl-PL';
    expect(await overview()).toContain('Masz nieprzeczytane powiadomienia: 3');
  });

  it('is left out with nothing unread, or with the module off', async () => {
    unread = 0;
    expect(await overview()).not.toContain('/account/notifications');
    unread = 3;
    absent = ['customer_notifications'];
    countReads = 0;
    expect(await overview()).not.toContain('/account/notifications');
    expect(countReads).toBe(0);
  });
});
