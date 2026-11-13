import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerNotification } from '@endora-commerce/contracts';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/179-rfq-and-customer-notifications/` T082 — `GET
 * /account/notifications/<id>/open` (FR-050a, research R-24 (a)).
 *
 * Marks the entry read and answers `303` to its link in the request's
 * language. A failed mark still redirects; an entry with no link, an unknown
 * id, a link that is not storefront-relative, or the module being off all
 * land on the page. The target is always the stored link, never something the
 * URL carries.
 */

let session: string | null = 'session-cookie';
let absent: string[] = [];
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => session,
  getAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'pl-PL',
    ctx: { locale: 'pl-PL', salesChannelCode: 'retail' },
    modules: { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent },
    urlState: {
      languages: [
        { languageCode: 'en-US', prefix: 'en', prefixed: false, isDefault: true },
        { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: false },
      ],
      aliases: [],
      current: 'pl-PL',
    },
  }),
}));

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000009';

function entry(id: string, linkPath: string | null): CustomerNotification {
  return {
    id,
    kind: 'quote_requests.approved',
    title: 'Approved',
    body: null,
    subject: null,
    linkPath,
    createdAt: '2026-11-13T10:00:00.000Z',
    readAt: null,
  };
}

let pages: Record<string, { items: CustomerNotification[]; nextCursor: string | null }>;
const listCalls: Array<string | null> = [];
const marked: string[] = [];
let markFailure: unknown = null;
vi.mock('../../lib/api/customer-notifications', () => ({
  listCustomerNotifications: async (_s: string, _ctx: unknown, page: { cursor: string | null }) => {
    listCalls.push(page.cursor);
    const answer = pages[page.cursor ?? ''] ?? { items: [], nextCursor: null };
    return { ...answer, unreadCount: 1 };
  },
  markCustomerNotificationRead: async (_s: string, _ctx: unknown, id: string) => {
    marked.push(id);
    if (markFailure) throw markFailure;
  },
}));

const { GET } = await import('../../app/(account)/account/notifications/[id]/open/route');

async function open(id: string, query = ''): Promise<Response> {
  return GET(new Request(`http://shop.test/pl/account/notifications/${id}/open${query}`) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  session = 'session-cookie';
  absent = [];
  markFailure = null;
  listCalls.length = 0;
  marked.length = 0;
  pages = { '': { items: [entry(OTHER, null), entry(ID, '/quote-requests/abc')], nextCursor: null } };
});

describe('notification open route', () => {
  it('marks the entry read, then answers 303 to its localised link', async () => {
    const res = await open(ID);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pl/quote-requests/abc');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(marked).toEqual([ID]);
  });

  it('still redirects to the link when marking fails', async () => {
    markFailure = new StorefrontApiError(500, 'INTERNAL', 'boom');
    const res = await open(ID);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pl/quote-requests/abc');
  });

  it('reads from the page cursor the row carried, and on to the next page', async () => {
    pages = {
      c1: { items: [entry(OTHER, null)], nextCursor: 'c2' },
      c2: { items: [entry(ID, '/quote-requests/abc')], nextCursor: null },
    };
    const res = await open(ID, '?cursor=c1');
    expect(listCalls).toEqual(['c1', 'c2']);
    expect(res.headers.get('location')).toBe('/pl/quote-requests/abc');
  });

  it('lands on the page for an entry without a link', async () => {
    const res = await open(OTHER);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pl/account/notifications');
  });

  it('lands on the page for an unknown id, and marks nothing', async () => {
    const res = await open('00000000-0000-4000-8000-00000000dead');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pl/account/notifications');
    expect(marked).toEqual([]);
  });

  it('never follows a link that is not storefront-relative', async () => {
    pages = { '': { items: [entry(ID, '//evil.example/x')], nextCursor: null } };
    expect((await open(ID)).headers.get('location')).toBe('/pl/account/notifications');
    pages = { '': { items: [entry(ID, 'https://evil.example/x')], nextCursor: null } };
    expect((await open(ID)).headers.get('location')).toBe('/pl/account/notifications');
  });

  it('sends a signed-out visitor to sign in, back to the page', async () => {
    session = null;
    const res = await open(ID);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/pl/login?next=${encodeURIComponent('/account/notifications')}`);
    expect(listCalls).toEqual([]);
  });

  it('reads nothing while the module is off and lands on the page (its 404)', async () => {
    absent = ['customer_notifications'];
    const res = await open(ID);
    expect(res.headers.get('location')).toBe('/pl/account/notifications');
    expect(listCalls).toEqual([]);
    expect(marked).toEqual([]);
  });
});
