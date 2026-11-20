import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../helpers/core-bundle';
import { adminSession, withSession } from '../helpers/render-with-session';
import { installOffsetParentShim } from '../helpers/layout-shim';
import { setMobileViewport } from '../setup';

/**
 * Issue #1500 (UX audit 2026-11-17, SALES-24) — the sales lists came in three
 * shapes: Orders, Quote Requests and Returns drew a toolbar card, a bulk-bar
 * card and a results card, with one sentence for "nothing yet" and "nothing
 * matches"; Customers, Organizations and Carts had a filter row but no
 * toolbar landmark, no chips and a hand-drawn empty block. Every one of them
 * is now the kit's `ListPage`: a `PageHeader` with the create action, the kit
 * `ListToolbar` (a `search` landmark), one results card holding the bulk bar,
 * the table and the pager, the kit `EmptyState` in both its variants, and a
 * `RowActionMenu` where a row has something to do besides being opened.
 */
installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => api.get(...a),
      post: (...a: unknown[]) => api.post(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrdersList } = await import('../../../packages/modules/orders/src/admin/pages/OrdersList');
const { RfqList } = await import('../../../packages/modules/quote_requests/src/admin/pages/RfqList');
const { ReturnsList } = await import('../../../packages/modules/returns/src/admin/pages/ReturnsList');
const { CustomersList } = await import('../../../packages/modules/customers/src/admin/pages/CustomersList');
const { OrganizationsList } = await import('../../../packages/modules/organizations/src/admin/pages/OrganizationsList');
const CartsList = (await import('../../../packages/modules/carts/src/admin/pages/CartsList')).default;

const BUNDLE = {
  ...shippedCoreBundle('en'),
  ...shippedModuleBundle('orders', 'en'),
  ...shippedModuleBundle('quote_requests', 'en'),
  ...shippedModuleBundle('returns', 'en'),
  ...shippedModuleBundle('customers', 'en'),
  ...shippedModuleBundle('organizations', 'en'),
  ...shippedModuleBundle('carts', 'en'),
};
const core = BUNDLE.core!;
const orders = BUNDLE.orders!;
const rfq = BUNDLE.quote_requests!;
const returns = BUNDLE.returns!;
const customers = BUNDLE.customers!;
const organizations = BUNDLE.organizations!;
const carts = BUNDLE.carts!;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

function render(subject: ReactNode, permissions: string[] = ['*']): void {
  renderWithI18n(
    withSession(<MemoryRouter>{subject}</MemoryRouter>, { session: adminSession({ permissions }) }),
    BUNDLE,
  );
}

/** Every request whose path starts with `prefix`. */
const calls = (prefix: string): string[] =>
  api.get.mock.calls.map((c) => c[0] as string).filter((path) => path.startsWith(prefix));

/** The one results region: the card that holds the table (or the empty state) and the pager. */
const resultsCard = (inside: HTMLElement): HTMLElement => inside.closest<HTMLElement>('[data-slot="card"]')!;

async function openRowMenu(name: string): Promise<HTMLElement> {
  fireEvent.pointerDown(await screen.findByRole('button', { name }), { button: 0, ctrlKey: false });
  return screen.findByRole('menu');
}

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const orderRow = (id: string, businessId: string) => ({
  id,
  businessId,
  customerName: 'Jan Kowalski',
  organizationId: ORG_ID,
  organizationName: 'Acme',
  status: 'new',
  statusName: { en: 'New' },
  paymentStatus: 'awaiting_payment',
  total: 10,
  currency: 'PLN',
  placedAt: '2026-05-22T12:00:00Z',
  createdAt: '2026-05-22T12:00:00Z',
  salesChannelId: 'c1',
  salesChannelName: 'Web',
  deliveryMethodName: null,
  paymentMethodName: null,
  shipToName: null,
  billToName: null,
});

function answerOrders(rows: ReturnType<typeof orderRow>[]): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return { data: { statuses: [{ code: 'new', name: { en: 'New' }, color: '#000000' }, { code: 'paid', name: { en: 'Paid' }, color: '#000000' }] } };
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) return { data: [] };
    if (path.startsWith('/api/v1/admin/orders/custom-field-filters')) return { data: [] };
    if (path.startsWith('/api/v1/admin/orders?')) {
      const searched = new URL(path, 'http://x').searchParams.has('q');
      const data = searched ? [] : rows;
      return { data, pagination: { page: 1, pageSize: 20, total: data.length }, counts: {} };
    }
    return { data: [], items: [] };
  });
}

describe('Orders list (#1500)', () => {
  it('is one list page: New order in the header, the toolbar landmark, one results card with the count', async () => {
    answerOrders([orderRow('o1', 'ORD-1')]);
    render(<OrdersList />);
    const link = await screen.findByRole('link', { name: '#ORD-1' });
    expect(screen.getByRole('link', { name: orders['actions.newOrder.label']! })).toHaveAttribute('href', '/orders/new');
    expect(screen.getByRole('search', { name: core['orders.toolbar.label']! })).toBeInTheDocument();
    expect(screen.getByText(fill(orders['list.count']!, { count: 1 }))).toHaveAttribute('role', 'status');
    // The toolbar is not a card of its own any more.
    expect(screen.getByRole('search').closest('[data-slot="card"]')).toBeNull();
    expect(within(resultsCard(link)).getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('offers no New order to an operator who cannot create one', async () => {
    answerOrders([orderRow('o1', 'ORD-1')]);
    render(<OrdersList />, ['orders:read']);
    await screen.findByRole('link', { name: '#ORD-1' });
    expect(screen.queryByRole('link', { name: orders['actions.newOrder.label']! })).not.toBeInTheDocument();
  });

  it('draws the bulk bar inside the results card, not as a card of its own', async () => {
    answerOrders([orderRow('o1', 'ORD-1')]);
    render(<OrdersList />);
    const link = await screen.findByRole('link', { name: '#ORD-1' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select order ORD-1' }));
    const bulk = screen.getByRole('button', { name: core['orders.bulk.changeStatus']! });
    expect(resultsCard(bulk)).toBe(resultsCard(link));
  });

  it('tells "no orders yet" apart from "no order matches", and Clear filters empties the search', async () => {
    answerOrders([]);
    render(<OrdersList />);
    const empty = await screen.findByText(orders['list.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');

    answerOrders([orderRow('o1', 'ORD-1')]);
    await userEvent.type(screen.getByRole('searchbox', { name: core['orders.field.search']! }), 'zzz');
    // The empty state follows the results: "no match" once the search has been asked, not while typing.
    expect(screen.getByText(orders['list.emptyTitle']!)).toBeInTheDocument();
    await waitFor(() => expect(calls('/api/v1/admin/orders?').at(-1)).toContain('q=zzz'));
    const noMatch = await screen.findByText(orders['list.emptyFiltered']!, {}, { timeout: 2000 });
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
    await userEvent.click(screen.getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    await screen.findByRole('link', { name: '#ORD-1' }, { timeout: 2000 });
    expect(screen.getByRole('searchbox', { name: core['orders.field.search']! })).toHaveValue('');
  });

  it('changes one order’s status from its row menu', async () => {
    answerOrders([orderRow('o1', 'ORD-1'), orderRow('o2', 'ORD-2')]);
    api.post.mockResolvedValue({ data: { changed: ['o2'], skipped: [] } });
    render(<OrdersList />);
    const menu = await openRowMenu(fill(orders['list.rowMenu.label']!, { number: 'ORD-2' }));
    expect(within(menu).getByRole('menuitem', { name: orders['list.rowMenu.organization']! })).toHaveAttribute(
      'href',
      `/organizations/${ORG_ID}`,
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: orders['list.rowMenu.changeStatus']! }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'paid');
    await userEvent.click(within(dialog).getByRole('button', { name: core['orders.bulk.apply']! }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/orders/bulk/status', { orderIds: ['o2'], toStatusCode: 'paid' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Quote Requests
// ---------------------------------------------------------------------------

const rfqRow = (id: string, businessId: string) => ({
  id,
  businessId,
  organizationId: ORG_ID,
  organizationName: 'Acme',
  customerAccountId: 'u1',
  customerDisplayName: 'Jan',
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  lineCount: 1,
  amount: '10.00',
  agreement: 'agreed',
  currency: 'PLN',
  submittedAt: null,
  expiresAt: null,
  updatedAt: '2026-05-22T12:00:00Z',
  version: 1,
});

function answerRfqs(rows: ReturnType<typeof rfqRow>[]): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/quote-requests/list-views')) return { data: [] };
    if (path.startsWith('/api/v1/admin/quote-requests/custom-field-filters')) return { data: [] };
    if (path.startsWith('/api/v1/admin/quote-requests?')) {
      const searched = new URL(path, 'http://x').searchParams.has('q');
      const data = searched ? [] : rows;
      return { data, pagination: { page: 1, pageSize: 20, total: data.length } };
    }
    return { data: [] };
  });
}

describe('Quote Requests list (#1500)', () => {
  it('is one list page with the kit toolbar, its More filters disclosure and the count', async () => {
    answerRfqs([rfqRow('r1', 'QR-1')]);
    render(<RfqList />);
    const link = await screen.findByRole('link', { name: '#QR-1' });
    expect(screen.getByRole('link', { name: core['rfq.list.create']! })).toHaveAttribute('href', '/quote-requests/new');
    const toolbar = screen.getByRole('search', { name: rfq['list.toolbar.label']! });
    expect(toolbar.closest('[data-slot="card"]')).toBeNull();
    expect(within(toolbar).getByRole('button', { name: core['common.listToolbar.moreFilters']! })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText(fill(rfq['list.count']!, { count: 1 }))).toHaveAttribute('role', 'status');
    expect(within(resultsCard(link)).getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('opens the organization from the row menu', async () => {
    answerRfqs([rfqRow('r1', 'QR-1')]);
    render(<RfqList />);
    const menu = await openRowMenu(fill(rfq['list.rowMenu.label']!, { number: 'QR-1' }));
    expect(within(menu).getByRole('menuitem', { name: rfq['list.rowMenu.organization']! })).toHaveAttribute(
      'href',
      `/organizations/${ORG_ID}`,
    );
  });

  it('tells "no quote requests yet" apart from "none matches"', async () => {
    answerRfqs([]);
    render(<RfqList />);
    const empty = await screen.findByText(rfq['list.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');
    expect(within(empty.closest<HTMLElement>('[data-empty-state]')!).getByRole('link', { name: core['rfq.list.create']! })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: core['rfq.list.field.search']! }), 'zzz');
    const noMatch = await screen.findByText(core['rfq.list.empty']!, {}, { timeout: 2000 });
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
  });
});

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

const returnRow = (id: string, reference: string, orderId: string | null) => ({
  id,
  rmaNumber: null,
  reference,
  kind: 'return',
  orderId,
  offPlatform: false,
  guest: false,
  productLabel: null,
  lineCount: 1,
  purchaseDate: null,
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  customerAccountId: null,
  customerName: 'Jan',
  organizationName: 'Acme',
  authorizedBy: null,
});

function answerReturns(rows: ReturnType<typeof returnRow>[]): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/returns/statuses')) return { data: { statuses: [], transitions: [] } };
    if (path.startsWith('/api/v1/admin/returns/list-views')) return { data: [] };
    if (path.startsWith('/api/v1/admin/returns?')) {
      const searched = new URL(path, 'http://x').searchParams.has('q');
      const data = searched ? [] : rows;
      return { data: { rows: data, total: data.length, counts: {} } };
    }
    return { data: [] };
  });
}

describe('Returns list (#1500)', () => {
  it('folds the four configuration links into one labelled menu beside the export', async () => {
    answerReturns([returnRow('a1', '#RMA-1', 'o1')]);
    render(<ReturnsList />);
    await screen.findByRole('link', { name: '#RMA-1' });
    expect(screen.queryByRole('link', { name: core['returns.nav.reasons']! })).not.toBeInTheDocument();
    const menu = await openRowMenu(returns['list.settingsMenu.label']!);
    expect(within(menu).getByRole('menuitem', { name: core['returns.nav.reasons']! })).toHaveAttribute('href', '/returns/reasons');
    expect(within(menu).getByRole('menuitem', { name: core['returns.nav.workflow']! })).toHaveAttribute('href', '/returns/statuses');
  });

  it('is one list page: the toolbar landmark, the bulk bar inside the results card, the count', async () => {
    answerReturns([returnRow('a1', '#RMA-1', 'o1')]);
    render(<ReturnsList />);
    const link = await screen.findByRole('link', { name: '#RMA-1' });
    expect(screen.getByRole('search', { name: returns['list.toolbar.label']! }).closest('[data-slot="card"]')).toBeNull();
    expect(screen.getByText(fill(returns['list.count']!, { count: 1 }))).toHaveAttribute('role', 'status');
    await userEvent.click(screen.getByRole('checkbox', { name: fill(returns['list.selection.selectRow']!, { number: '#RMA-1' }) }));
    expect(resultsCard(screen.getByRole('button', { name: fill(core['returns.bulk.authorize']!, { count: 1 }) }))).toBe(resultsCard(link));
  });

  it('opens the order a case was filed against from its row menu, and offers no menu without one', async () => {
    answerReturns([returnRow('a1', '#RMA-1', 'o1'), returnRow('a2', '#RMA-2', null)]);
    render(<ReturnsList />);
    const menu = await openRowMenu(fill(returns['list.rowMenu.label']!, { number: '#RMA-1' }));
    expect(within(menu).getByRole('menuitem', { name: returns['list.rowMenu.order']! })).toHaveAttribute('href', '/orders/o1');
    expect(screen.queryByRole('button', { name: fill(returns['list.rowMenu.label']!, { number: '#RMA-2' }) })).not.toBeInTheDocument();
  });

  it('tells "no cases yet" apart from "no case matches"', async () => {
    answerReturns([]);
    render(<ReturnsList />);
    const empty = await screen.findByText(returns['list.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');
    await userEvent.type(screen.getByRole('searchbox', { name: returns['list.search.label']! }), 'zzz');
    const noMatch = await screen.findByText(returns['list.emptyFiltered']!, {}, { timeout: 2000 });
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
  });
});

// ---------------------------------------------------------------------------
// Customers, Organizations, Carts — already `ListPage`; now the kit toolbar,
// the kit empty state and, where a row has somewhere to go, the row menu.
// ---------------------------------------------------------------------------

describe('Customers list (#1500)', () => {
  const customer = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'buyer@example.com',
    firstName: 'Buyer',
    lastName: 'One',
    organizationId: ORG_ID,
    organizationName: 'Acme',
    customerGroupId: null,
    customerGroupName: null,
    blocked: false,
    deleted: false,
    createdAt: '2026-05-01T09:00:00.000Z',
    lastLoginAt: null,
  };
  const answer = (rows: (typeof customer)[]): void => {
    api.get.mockImplementation(async (path: string) => {
      const data = path.includes('q=') ? [] : rows;
      return { data, meta: { page: 1, pageSize: 20, total: data.length } };
    });
  };

  it('has the toolbar landmark and the row menu to the organization', async () => {
    answer([customer]);
    render(<CustomersList />);
    await screen.findByRole('link', { name: 'Buyer One' });
    expect(screen.getByRole('search', { name: customers['list.toolbar.label']! })).toBeInTheDocument();
    const menu = await openRowMenu(fill(customers['list.rowMenu.label']!, { name: 'Buyer One' }));
    expect(within(menu).getByRole('menuitem', { name: customers['list.rowMenu.organization']! })).toHaveAttribute(
      'href',
      `/organizations/${ORG_ID}`,
    );
  });

  it('draws the kit empty state in both variants', async () => {
    answer([]);
    render(<CustomersList />);
    const empty = await screen.findByText(customers['list.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');
    await userEvent.type(screen.getByRole('searchbox', { name: customers['list.field.search']! }), 'x');
    const noMatch = await screen.findByText(customers['list.emptyFiltered']!);
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
  });
});

describe('Organizations list (#1500)', () => {
  it('has the toolbar landmark and the kit empty state in both variants', async () => {
    api.get.mockImplementation(async (path: string) => ({ data: [], meta: { page: 1, pageSize: 20, total: 0 }, path }));
    render(<OrganizationsList />);
    const empty = await screen.findByText(organizations['list.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');
    expect(screen.getByRole('search', { name: organizations['list.toolbar.label']! })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: core['organizations.field.search']! }), 'x');
    const noMatch = await screen.findByText(organizations['list.emptyFiltered']!);
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
  });
});

describe('Carts list (#1500)', () => {
  const cart = {
    id: '00000000-0000-4000-8000-0000000000c1',
    ownerCustomerAccountId: null,
    ownerDisplayName: 'Jan Kowalski',
    organizationId: ORG_ID,
    organizationDisplayName: 'Acme',
    salesChannelId: null,
    salesChannelCode: null,
    status: 'active',
    approvalStatus: 'not_required',
    itemCount: 1,
    total: { amount: 10, currency: 'PLN' },
    appliedPromotionCode: null,
    lastActivityAt: '2026-05-01T09:00:00.000Z',
    createdAt: '2026-05-01T09:00:00.000Z',
  };
  const answer = (rows: (typeof cart)[]): void => {
    api.get.mockImplementation(async (path: string) => {
      const data = path.includes('status=') ? [] : rows;
      return { data, meta: { page: 1, pageSize: 20, totalCount: data.length } };
    });
  };

  it('has the toolbar landmark and the row menu to the organization', async () => {
    answer([cart]);
    render(<CartsList />);
    await screen.findByRole('link', { name: 'Jan Kowalski' });
    expect(screen.getByRole('search', { name: carts['carts.toolbar.label']! })).toBeInTheDocument();
    const menu = await openRowMenu(fill(carts['carts.rowMenu.label']!, { name: 'Jan Kowalski' }));
    expect(within(menu).getByRole('menuitem', { name: carts['carts.rowMenu.organization']! })).toHaveAttribute(
      'href',
      `/organizations/${ORG_ID}`,
    );
  });

  it('draws the kit empty state in both variants', async () => {
    answer([]);
    render(<CartsList />);
    const empty = await screen.findByText(carts['carts.emptyTitle']!);
    expect(empty.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-data');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: carts['carts.column.status']! }), 'active');
    const noMatch = await screen.findByText(carts['carts.emptyFiltered']!);
    expect(noMatch.closest('[data-empty-state]')).toHaveAttribute('data-empty-state', 'no-results');
    expect(calls('/api/v1/admin/carts').at(-1)).toContain('status=active');
  });
});
