import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrgCartSummary } from '../../lib/api/cart';

/**
 * Issue #650 — `/organization/carts` leads to each cart's detail and can be
 * narrowed to the carts awaiting approval (`?approval=pending`), which is the
 * filter it passes to the API.
 */
let locale = 'en-US';
let isPersonal = false;
let permissions: string[] = ['carts.approve'];
let roleKind = 'custom';
let carts: OrgCartSummary[] = [];
const filters: unknown[] = [];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'buyer-1',
      organizationRole: { id: 'role-1', kind: roleKind, name: 'Purchasing' },
      permissions,
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal },
  }),
}));
vi.mock('../../lib/api/cart', () => ({
  listOrganizationCarts: async (_jar: unknown, filter: unknown) => {
    filters.push(filter);
    return { data: carts, meta: { page: 1, pageSize: 20, totalCount: carts.length } };
  },
}));

const { default: OrganizationCartsPage } = await import('../../app/(account)/organization/carts/page');

function summary(id: string, approvalStatus: OrgCartSummary['approvalStatus']): OrgCartSummary {
  return {
    id,
    ownerCustomerAccountId: `owner-${id}`,
    ownerDisplayName: `${id}@acme.example`,
    ownerEmail: `${id}@acme.example`,
    orderId: null,
    status: 'active',
    approvalStatus,
    itemCount: 1,
    total: { amount: 10, currency: 'PLN' },
    lastActivityAt: '2026-11-03T09:00:00.000Z',
    submittedForApprovalAt: approvalStatus === 'pending' ? '2026-11-03T09:00:00.000Z' : null,
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await OrganizationCartsPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  carts = [summary('c1', 'pending'), summary('c2', 'not_required')];
  filters.length = 0;
  isPersonal = false;
  permissions = ['carts.approve'];
  roleKind = 'custom';
});

/**
 * Feature 170 (FR-057, FR-070a) — the list follows `carts.approve` (FR-033),
 * not the Administrator role, and a personal Organization is sent back to the
 * account page.
 */
describe('organization carts list — who may see it (feature 170)', () => {
  it('lists the carts for an approver who is not the administrator', async () => {
    const html = await render();
    expect(html).toContain('href="/organization/carts/c1"');
  });

  it('refuses a member without carts.approve, and reads nothing', async () => {
    permissions = ['carts.create'];
    const html = await render();
    expect(html).toContain('Only members allowed to approve carts can see this page.');
    expect(filters).toEqual([]);
  });

  it('sends the member of a personal Organization to the account page', async () => {
    isPersonal = true;
    await expect(render()).rejects.toThrow('redirect /account');
    expect(filters).toEqual([]);
  });
});

describe('organization carts list — issue #650', () => {
  it('links every cart to its detail, a pending one as a review', async () => {
    const html = await render();
    expect(html).toContain('href="/organization/carts/c1"');
    expect(html).toContain('href="/organization/carts/c2"');
    expect(html).toContain('Review');
  });

  it('lists every cart unfiltered by default and marks that view current', async () => {
    const html = await render();
    expect(filters).toEqual([undefined]);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/organization\/carts"|<a[^>]*href="\/organization\/carts"[^>]*aria-current="page"/);
  });

  it('asks the API for pending carts only under ?approval=pending, and marks that view current', async () => {
    carts = [summary('c1', 'pending')];
    const html = await render({ approval: 'pending' });
    expect(filters).toEqual([{ approvalStatus: ['pending'] }]);
    expect(html).toMatch(/href="\/organization\/carts\?approval=pending"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/organization\/carts\?approval=pending"/);
  });

  it.each([
    ['en-US', 'No carts are awaiting approval.', 'Awaiting approval', 'All carts'],
    ['pl-PL', 'Żaden koszyk nie oczekuje na akceptację.', 'Oczekujące na akceptację', 'Wszystkie koszyki'],
  ])('says nothing is waiting, in %s', async (l, empty, pendingTab, allTab) => {
    locale = l;
    carts = [];
    const html = await render({ approval: 'pending' });
    expect(html).toContain(empty);
    expect(html).toContain(pendingTab);
    expect(html).toContain(allTab);
  });
});

/**
 * Issue #751 — presentation fixes from the feature 170 demo review: the owner
 * is named as on the members page, a completed cart does not read as an empty
 * one, and the total says it is net.
 */
describe('organization carts list — issue #751', () => {
  it.each(['en-US', 'pl-PL'])('names the owner by full name, the e-mail beside it (%s)', async (l) => {
    locale = l;
    carts = [{ ...summary('c1', 'pending'), ownerDisplayName: 'Jan Kowalski', ownerEmail: 'jan@acme.example' }];
    const html = await render();
    expect(html).toMatch(/<td>Jan Kowalski<small[^>]*>jan@acme\.example<\/small><\/td>/);
  });

  it('does not repeat the e-mail when the owner has no name to show', async () => {
    carts = [summary('c1', 'pending')];
    const html = await render();
    expect(html.split('c1@acme.example')).toHaveLength(2);
  });

  it.each(['en-US', 'pl-PL'])('leaves the items and total of a completed cart empty, not zero (%s)', async (l) => {
    locale = l;
    carts = [
      {
        ...summary('c3', 'not_required'),
        status: 'completed',
        itemCount: 0,
        total: { amount: 0, currency: 'PLN' },
      },
    ];
    const html = await render();
    expect(html).not.toMatch(/<td>0<\/td>/);
    expect(html).not.toContain('0,00');
    expect(html).toMatch(/<\/span><\/td><td>—<\/td><td>—<\/td>/);
  });

  it.each([
    ['en-US', 'net'],
    ['pl-PL', 'netto'],
  ])('labels the total as net, as the cart page does (%s)', async (l, net) => {
    locale = l;
    carts = [summary('c1', 'pending')];
    const html = await render();
    expect(html).toMatch(new RegExp(`10,00\\s*zł<span[^>]*>${net}</span>`));
  });
});

/**
 * Owner ruling on PR #760 (issue #751): a completed cart links to the order it
 * produced — only for a viewer the order page would answer: the Administrator,
 * a role holding `orders.view_organization`, or the order's own buyer. Anyone
 * else keeps the empty cells; the order page would say "not found".
 */
describe('organization carts list — a completed cart links to its order (issue #751)', () => {
  const completed = (owner = 'owner-c3'): OrgCartSummary => ({
    ...summary('c3', 'not_required'),
    ownerCustomerAccountId: owner,
    status: 'completed',
    itemCount: 0,
    total: { amount: 0, currency: 'PLN' },
    orderId: '00000000-0000-4000-8000-000000000751',
  });
  const link = (text: string): RegExp =>
    new RegExp(`<td colSpan="2"><a[^>]*href="/orders/00000000-0000-4000-8000-000000000751"[^>]*>${text}</a></td>`, 'i');

  it.each([
    ['en-US', 'View order'],
    ['pl-PL', 'Zobacz zamówienie'],
  ])('links it for a role holding orders.view_organization (%s)', async (l, text) => {
    locale = l;
    permissions = ['carts.approve', 'orders.view_organization'];
    carts = [completed()];
    expect(await render()).toMatch(link(text));
  });

  it('links it for the Administrator', async () => {
    roleKind = 'administrator';
    carts = [completed()];
    expect(await render()).toMatch(link('View order'));
  });

  it('links it for the buyer who placed the order', async () => {
    carts = [completed('buyer-1')];
    expect(await render()).toMatch(link('View order'));
  });

  it('keeps the empty cells for a viewer the order page would not answer', async () => {
    carts = [completed()];
    const html = await render();
    expect(html).not.toContain('/orders/');
    expect(html).toMatch(/<\/span><\/td><td>—<\/td><td>—<\/td>/);
  });

  it('keeps the empty cells for a completed cart that names no order', async () => {
    permissions = ['carts.approve', 'orders.view_organization'];
    carts = [{ ...completed(), orderId: null }];
    const html = await render();
    expect(html).not.toContain('/orders/');
    expect(html).toMatch(/<\/span><\/td><td>—<\/td><td>—<\/td>/);
  });
});
