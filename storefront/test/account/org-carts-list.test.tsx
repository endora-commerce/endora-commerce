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
      organizationRole: { id: 'role-1', kind: 'custom', name: 'Purchasing' },
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
