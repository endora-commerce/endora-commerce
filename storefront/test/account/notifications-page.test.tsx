import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { CustomerNotification } from '@endora-commerce/contracts';
import type { MeResult } from '../../lib/api/account';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/179-rfq-and-customer-notifications/` T080 — the account area's
 * *Notifications* page (FR-050, FR-050a, FR-050b, FR-052,
 * `contracts/customer-notifications-storefront-api.md` §3).
 *
 * Server-rendered only: the list, the page's states, and what each row is — a
 * link to the open route for an entry with a link, a *Mark as read* form for
 * one without. The open route and the two server actions have their own files.
 */

const NOT_FOUND = 'NEXT_NOT_FOUND';
vi.mock('next/navigation', () => ({
  usePathname: () => '/account/notifications',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

let locale = 'en-US';
let absent: string[] = [];
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    ctx: { locale, salesChannelCode: 'retail' },
    modules: { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent },
    urlState: { languages: [], aliases: [], current: locale },
  }),
}));

let impersonating = false;
let withOrganization = true;
vi.mock('../../lib/api/account', () => ({
  getMe: async (): Promise<MeResult> => ({
    customerAccount: {
      id: 'acc-1',
      organizationId: withOrganization ? 'org-1' : null,
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: null,
      permissions: [],
      emailVerifiedAt: null,
      twoFactorEnabled: false,
    } as unknown as MeResult['customerAccount'],
    organization: withOrganization
      ? ({ id: 'org-1', name: 'Acme', isPersonal: false } as MeResult['organization'])
      : null,
    impersonation: impersonating ? { impersonatorAdminUserId: 'admin-1' } : null,
  }),
}));

let pushEnabled = true;
vi.mock('../../lib/api/pwa-server', () => ({
  fetchPwaConfig: async () => ({ pushEnabled }),
}));

const NOW = new Date('2026-11-13T12:00:00.000Z');
const ID_LINK = '00000000-0000-4000-8000-000000000001';
const ID_PLAIN = '00000000-0000-4000-8000-000000000002';
const ID_READ = '00000000-0000-4000-8000-000000000003';

function entry(overrides: Partial<CustomerNotification>): CustomerNotification {
  return {
    id: ID_LINK,
    kind: 'quote_requests.approved',
    title: 'Your quote request Q-1 was approved',
    body: null,
    subject: null,
    linkPath: null,
    createdAt: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
    readAt: null,
    ...overrides,
  };
}

let listAnswer: { items: CustomerNotification[]; nextCursor: string | null; unreadCount: number } | Error;
const listCalls: Array<{ cursor: string | null }> = [];
vi.mock('../../lib/api/customer-notifications', () => ({
  listCustomerNotifications: async (_session: string, _ctx: unknown, page: { cursor: string | null }) => {
    listCalls.push({ cursor: page.cursor });
    if (listAnswer instanceof Error) throw listAnswer;
    return listAnswer;
  },
  markCustomerNotificationRead: async () => undefined,
  markAllCustomerNotificationsRead: async () => 0,
  getUnreadNotificationCount: async () => 0,
}));

const { default: NotificationsPage } = await import('../../app/(account)/account/notifications/page');

async function page(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToString(<>{(await NotificationsPage({ searchParams: Promise.resolve(searchParams) })) as ReactNode}</>);
}

function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-notification-id="${id}"`);
  expect(start, `row ${id}`).toBeGreaterThan(-1);
  const end = html.indexOf('</li>', start);
  return html.slice(start, end);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  locale = 'en-US';
  absent = [];
  impersonating = false;
  withOrganization = true;
  pushEnabled = true;
  listCalls.length = 0;
  listAnswer = {
    items: [
      entry({ id: ID_LINK, linkPath: '/quote-requests/00000000-0000-4000-8000-0000000000aa' }),
      entry({ id: ID_PLAIN, title: 'A note without a link', linkPath: null }),
      entry({
        id: ID_READ,
        title: 'An old one',
        linkPath: '/quote-requests/00000000-0000-4000-8000-0000000000bb',
        createdAt: '2026-10-01T09:00:00.000Z',
        readAt: '2026-10-02T09:00:00.000Z',
      }),
    ],
    nextCursor: null,
    unreadCount: 2,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notifications page — rows', () => {
  it('marks an unread entry with the "New" text label and semibold weight, not colour alone', async () => {
    const row = rowOf(await page(), ID_LINK);
    expect(row).toContain('>New<');
    expect(row).toContain('font-semibold');
  });

  it('renders a read entry without the label, in regular weight', async () => {
    const row = rowOf(await page(), ID_READ);
    expect(row).not.toContain('>New<');
    expect(row).not.toContain('font-semibold');
  });

  it('makes an entry with a link one link to its open route', async () => {
    const row = rowOf(await page(), ID_LINK);
    expect(row).toContain(`href="/account/notifications/${ID_LINK}/open"`);
    expect(row).not.toContain('<button');
  });

  it('links to the open route without the page cursor: the route reads the entry by id', async () => {
    const row = rowOf(await page({ cursor: 'abc' }), ID_LINK);
    expect(row).toContain(`href="/account/notifications/${ID_LINK}/open"`);
    expect(row).not.toContain('/open?');
    expect(listCalls).toEqual([{ cursor: 'abc' }]);
  });

  it('gives an entry without a link a Mark as read button and no link surface', async () => {
    const row = rowOf(await page(), ID_PLAIN);
    expect(row).not.toContain('<a ');
    expect(row).toContain('Mark as read');
    expect(row).toContain('type="submit"');
    expect(row).toContain(`name="id" value="${ID_PLAIN}"`);
  });

  it('shows a recent date relatively and an older one absolutely, both as <time dateTime>', async () => {
    const html = await page();
    const recent = rowOf(html, ID_LINK);
    expect(recent).toContain(`dateTime="${new Date(NOW.getTime() - 2 * 3_600_000).toISOString()}"`);
    expect(recent).toMatch(/2 hr\. ago|2 hours ago/);
    const old = rowOf(html, ID_READ);
    expect(old).toContain('dateTime="2026-10-01T09:00:00.000Z"');
    expect(old).toContain(new Date('2026-10-01T09:00:00.000Z').toLocaleDateString('en-US'));
  });

  it('is in Polish for a Polish buyer', async () => {
    locale = 'pl-PL';
    const html = await page();
    expect(html).toContain('Powiadomienia');
    expect(rowOf(html, ID_LINK)).toContain('>Nowe<');
    expect(rowOf(html, ID_LINK)).toContain('2 godz. temu');
    expect(rowOf(html, ID_PLAIN)).toContain('Oznacz jako przeczytane');
    expect(html).toContain('Oznacz wszystkie jako przeczytane');
  });
});

describe('notifications page — heading, status and Mark all as read', () => {
  it('always renders a status region beside the heading, empty until something happened', async () => {
    const html = await page();
    expect(html).toMatch(/<h2[^>]*id="notifications-heading"[^>]*tabindex="-1"|<h2[^>]*tabindex="-1"[^>]*id="notifications-heading"/i);
    expect(html).toMatch(/role="status"[^>]*><\/div>/);
  });

  it('announces the result after Mark all as read and moves focus to the heading', async () => {
    listAnswer = { items: [entry({ readAt: NOW.toISOString() })], nextCursor: null, unreadCount: 0 };
    const html = await page({ marked: 'all' });
    expect(html).toMatch(/role="status"[^>]*>All notifications are marked as read<\/div>/);
    expect(html).toContain('data-focus-target="notifications-heading"');
  });

  it('offers Mark all as read only while something is unread', async () => {
    expect(await page()).toContain('Mark all as read');
    listAnswer = { items: [entry({ readAt: NOW.toISOString() })], nextCursor: null, unreadCount: 0 };
    expect(await page()).not.toContain('Mark all as read');
  });

  it('disables every mark control under impersonation and says why', async () => {
    impersonating = true;
    const html = await page();
    expect(html).toContain('Read state is not changed while impersonating');
    const markAll = html.slice(html.lastIndexOf('<button', html.indexOf('Mark all as read')), html.indexOf('Mark all as read'));
    expect(markAll).toContain('disabled');
    expect(markAll).toContain('aria-describedby=');
    expect(rowOf(html, ID_PLAIN)).toMatch(/<button[^>]*disabled/);
  });

  it('shows a specific error with a retry after a failed mark', async () => {
    const html = await page({ markError: '1' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('could not be marked as read');
    // The retry is the mark control itself, still offered.
    expect(html).toContain('Mark all as read');
  });
});

describe('notifications page — empty, error, paging, footer, off', () => {
  it('explains an empty centre and offers the way to quote requests', async () => {
    listAnswer = { items: [], nextCursor: null, unreadCount: 0 };
    const html = await page();
    expect(html).toContain("When something changes on your quote requests, you&#x27;ll see it here.");
    expect(html).toContain('href="/quote-requests"');
    expect(html).toContain('Go to quote requests');
    expect(html).toContain('<svg');
  });

  it('leaves the action out while quote_requests is off, or for a buyer with no Organization', async () => {
    listAnswer = { items: [], nextCursor: null, unreadCount: 0 };
    absent = ['quote_requests'];
    expect(await page()).not.toContain('Go to quote requests');
    absent = [];
    withOrganization = false;
    expect(await page()).not.toContain('Go to quote requests');
  });

  it('shows an error with a retry when the list cannot be read', async () => {
    listAnswer = new Error('boom');
    const html = await page();
    expect(html).toContain('role="alert"');
    expect(html).toContain('Your notifications could not be loaded.');
    expect(html).toContain('href="/account/notifications"');
    expect(html).toContain('Try again');
  });

  it('pages with the shared Pagination component, labelled "Show older"', async () => {
    listAnswer = { ...(listAnswer as { items: CustomerNotification[]; unreadCount: number }), nextCursor: 'next-1' };
    const html = await page();
    expect(html).toContain('href="/account/notifications?cursor=next-1"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('Show older');
  });

  it('links to the push preferences while push is offered', async () => {
    expect(await page()).toContain('href="/account#push-section-heading"');
    expect(await page()).toContain('Manage push notifications');
    pushEnabled = false;
    expect(await page()).not.toContain('Manage push notifications');
    pushEnabled = true;
    absent = ['pwa'];
    expect(await page()).not.toContain('Manage push notifications');
  });

  it("answers the shop's 404 while the module is off", async () => {
    absent = ['customer_notifications'];
    await expect(page()).rejects.toThrow(NOT_FOUND);
    expect(listCalls).toEqual([]);
  });

  it("answers the shop's 404 when the API says the module is off", async () => {
    listAnswer = new StorefrontApiError(503, 'MODULE_DISABLED', 'off');
    await expect(page()).rejects.toThrow(NOT_FOUND);
  });
});
