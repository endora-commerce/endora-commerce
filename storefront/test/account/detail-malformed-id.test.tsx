import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * Issue #749 — a buyer's record page (`/orders/[id]`, `/returns/[id]`,
 * `/quote-requests/[id]`, `/shopping-lists/[id]`, `/organization/carts/[id]`)
 * opened with an id that is not a UUID — the 8-character prefix the storefront
 * itself prints, say — renders the page's own not-found answer, as an unknown
 * UUID does, instead of a server-side exception.
 *
 * The id names a `uuid` column, and the API hands an unchecked one to
 * PostgreSQL, which refuses it: the answer is a `500`, not a `404`. Each
 * fetcher below answers a malformed id that way, so a page that still asks the
 * API rethrows it — the 500 of the issue.
 *
 * SSR-only: the page is awaited and rendered with its clients mocked.
 */
const MALFORMED = '1c0785cf';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const calls: string[] = [];

/** What the API answers a malformed id with, and a stand-in record otherwise. */
async function byId(fn: string, id: string): Promise<never> {
  calls.push(fn);
  if (!UUID_SHAPE.test(id)) {
    throw new StorefrontApiError(500, 'INTERNAL', 'invalid input syntax for type uuid');
  }
  throw new StorefrontApiError(404, 'NOT_FOUND', 'Not found.');
}

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { locale: 'en-US' } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'member-1',
      organizationRole: { id: 'role-1', kind: 'administrator', name: 'Administrator' },
      permissions: [
        'carts.create',
        'carts.approve',
        'quote_requests.create',
        'returns.create',
        'shopping_lists.create',
        'shopping_lists.convert',
      ],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: false },
    impersonation: null,
  }),
}));
vi.mock('../../lib/actions/cart', () => ({
  getCommerceAbilitiesAction: async () => ({
    editShoppingLists: true,
    convertListToCart: true,
    convertListToQuote: true,
  }),
}));
vi.mock('../../lib/api/orders', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/orders')>('../../lib/api/orders');
  return {
    ...actual,
    getMyOrder: (_s: string, id: string) => byId('getMyOrder', id),
    listOrderComments: async () => [],
  };
});
vi.mock('../../lib/api/returns', () => ({
  getReturnable: async () => ({ eligible: false }),
  getMyReturn: (_s: string, id: string) => byId('getMyReturn', id),
  addReturnComment: async () => undefined,
}));
vi.mock('../../lib/api/rfq', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/rfq')>('../../lib/api/rfq');
  return { ...actual, getRfqById: (_s: string, id: string) => byId('getRfqById', id) };
});
vi.mock('../../lib/api/shopping-lists', () => ({
  getShoppingList: (_s: string, id: string) => byId('getShoppingList', id),
  clearShoppingListItems: async () => undefined,
  convertShoppingListToCart: async () => ({ added: 0, skipped: [] }),
  convertShoppingListToRfq: async () => ({ rfqId: 'r', added: 0, skipped: [] }),
  removeShoppingListItem: async () => undefined,
  renameShoppingList: async () => undefined,
  updateShoppingListItem: async () => undefined,
}));
vi.mock('../../lib/api/cart', () => ({
  // The real client already answers `null` for a 404 and rethrows the rest.
  getOrganizationCart: async (_jar: unknown, id: string) => {
    try {
      return await byId('getOrganizationCart', id);
    } catch (err) {
      if (err instanceof StorefrontApiError && err.status === 404) return null;
      throw err;
    }
  },
  approveOrganizationCart: async () => undefined,
  rejectOrganizationCart: async () => undefined,
}));
vi.mock('../../lib/api/catalog', () => ({ getProductBySlug: async () => ({ name: 'Bolt', sku: 'B', slug: 'b' }) }));
vi.mock('../../lib/api/invoices', () => ({ listMyOrderInvoices: async () => [], invoiceDownloadUrl: () => '#' }));
vi.mock('../../lib/api/payments', () => ({ retryOrderPayment: async () => ({ opened: false }) }));
vi.mock('../../components/analytics/EcommerceTrackers', () => ({ PurchaseTracker: () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { default: OrderPage } = await import('../../app/(account)/orders/[id]/page');
const { default: ReturnPage } = await import('../../app/(account)/returns/[id]/page');
const { default: QuoteRequestPage } = await import('../../app/(account)/quote-requests/[id]/page');
const { default: ShoppingListPage } = await import('../../app/(account)/shopping-lists/[id]/page');
const { default: OrgCartPage } = await import('../../app/(account)/organization/carts/[id]/page');

async function html(element: unknown): Promise<string> {
  return renderToString((await element) as React.ReactElement);
}

const params = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  calls.length = 0;
});

describe('a malformed record id renders the not-found answer (issue #749)', () => {
  it('order detail', async () => {
    const out = await html(OrderPage(params(MALFORMED)));
    expect(out).toContain('Order not found');
    expect(calls).not.toContain('getMyOrder');
  });

  it('return detail sends the buyer to the list, as an unknown id does', async () => {
    await expect(ReturnPage(params(MALFORMED))).rejects.toThrow('redirect /returns');
    expect(calls).not.toContain('getMyReturn');
  });

  it('quote request detail', async () => {
    const out = await html(QuoteRequestPage(params(MALFORMED)));
    expect(out).toContain('Quote request not found.');
    expect(calls).not.toContain('getRfqById');
  });

  it('shopping list detail', async () => {
    const out = await html(ShoppingListPage(params(MALFORMED)));
    expect(out).toContain('Shopping list not found');
    expect(calls).not.toContain('getShoppingList');
  });

  it('organization cart detail says not found, not "could not load"', async () => {
    const out = await html(OrgCartPage(params(MALFORMED)));
    expect(out).toContain('This cart does not exist or is not in your organization.');
    expect(out).not.toContain('Could not load the cart.');
    expect(calls).not.toContain('getOrganizationCart');
  });

  it('an unknown well-formed id still reaches the API and gets its not-found', async () => {
    const unknown = '00000000-0000-4000-8000-000000000749';
    expect(await html(OrderPage(params(unknown)))).toContain('Order not found');
    await expect(ReturnPage(params(unknown))).rejects.toThrow('redirect /returns');
    expect(await html(QuoteRequestPage(params(unknown)))).toContain('Quote request not found.');
    expect(await html(ShoppingListPage(params(unknown)))).toContain('Shopping list not found');
    expect(await html(OrgCartPage(params(unknown)))).toContain('This cart does not exist');
    expect(calls).toEqual(['getMyOrder', 'getMyReturn', 'getRfqById', 'getShoppingList', 'getOrganizationCart']);
  });
});
