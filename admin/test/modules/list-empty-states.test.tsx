import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15), slices S12 and S13.
 *
 * S12 — a filtered list that is empty because of its filters says so and offers
 * *Clear filters* (`no-results`); the same list with nothing in it says that
 * instead (`no-data`), with the next step when the operator may take it. Before,
 * the inventory lists said "No … match the current filters" to an operator who
 * had applied none.
 *
 * S13 — a top-level list's empty body is the kit `EmptyState`, not a bare grey
 * sentence (architect ruling Q2: the empty area is the page's primary region).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

const REPO_ROOT = resolve(process.cwd(), '..');
const readBundle = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<string, string>;
const core = readBundle('packages/modules/_i18n/i18n/en.json');
const salesChannels = readBundle('packages/modules/sales_channels/i18n/en.json');
const credentials = readBundle('packages/modules/credentials/i18n/en.json');
const customers = readBundle('packages/modules/customers/i18n/en.json');
const ledger = readBundle('packages/modules/invoice_ledger/i18n/en.json');
const dictionaries = readBundle('packages/modules/dictionaries/i18n/en.json');
const BUNDLE: Bundle = {
  core,
  sales_channels: salesChannels,
  credentials,
  customers,
  invoice_ledger: ledger,
  dictionaries,
};

function mount(Page: ComponentType, permissions: readonly string[] = ['*']): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: ['inventory', 'sales_channels', 'credentials', 'customers', 'invoice_ledger', 'dictionaries'] }),
      },
    ),
    BUNDLE,
  );
  return user;
}

const emptyState = async (): Promise<HTMLElement> => {
  await waitFor(() => expect(document.querySelector('[data-empty-state]')).not.toBeNull());
  return document.querySelector('[data-empty-state]') as HTMLElement;
};

/** Answers `url` by the first matching prefix; anything else is a test bug. */
function answer(routes: Record<string, (url: string) => unknown>): void {
  getSpy.mockImplementation(async (url: string) => {
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`unexpected url ${url}`);
    return routes[match]!(url);
  });
}

beforeEach(() => {
  getSpy.mockReset();
});

// ---------------------------------------------------------------------------
// S12 — no-data vs no-results
// ---------------------------------------------------------------------------

describe('InventoryPage', () => {
  const kpis = { data: { totalProductsTracked: 0, totalOnHand: 0, outOfStockCount: 0, lowStockCount: 0, perWarehouseTotals: [] } };
  const ROW = {
    productId: '00000000-0000-4000-8000-0000000000f1',
    productSku: 'SKU-1',
    productName: 'Oak chair',
    cumulativeOnHand: 4,
    displayBand: 'high',
    lowStockThreshold: 1,
    perWarehouse: [],
  };
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/inventory/src/admin/pages/InventoryPage')).InventoryPage;

  it('says nothing is tracked yet, and offers the import, when no filter narrows it', async () => {
    answer({
      '/api/v1/admin/inventory/levels': () => ({ items: [], page: 0, pageSize: 25, total: 0 }),
      '/api/v1/admin/inventory': () => kpis,
    });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(core['inventory.noData.title']!)).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: core['inventory.action.import']! })).toHaveAttribute('href', '/inventory/import');
    // The empty state's import is the view's one primary; the header's is not repeated (Von Restorff).
    expect(screen.getAllByRole('link', { name: core['inventory.action.import']! })).toHaveLength(1);
  });

  it('offers no import to a read-only operator', async () => {
    answer({
      '/api/v1/admin/inventory/levels': () => ({ items: [], page: 0, pageSize: 25, total: 0 }),
      '/api/v1/admin/inventory': () => kpis,
    });
    mount(await load(), ['inventory:read']);
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).queryByRole('link')).toBeNull();
    expect(within(block).getByText(core['inventory.noData.bodyReadOnly']!)).toBeInTheDocument();
  });

  it('says the filters match nothing, and Clear filters brings the rows back', async () => {
    answer({
      '/api/v1/admin/inventory/levels': (url) =>
        url.includes('out=1') ? { items: [], page: 0, pageSize: 25, total: 0 } : { items: [ROW], page: 0, pageSize: 25, total: 1 },
      '/api/v1/admin/inventory': () => kpis,
    });
    const user = mount(await load());
    await screen.findByText('Oak chair');
    await user.click(screen.getByRole('button', { name: core['inventory.stat.outOfStock']! }));
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-results');
    expect(within(block).getByText(core['inventory.empty']!)).toBeInTheDocument();
    await user.click(within(block).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(await screen.findByText('Oak chair')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: core['inventory.stat.outOfStock']! })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
  });
});

describe('WarehousesList', () => {
  const WAREHOUSE = {
    id: '00000000-0000-4000-8000-0000000000a1',
    code: 'WH-1',
    name: 'Main',
    active: false,
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/inventory/src/admin/pages/WarehousesList')).WarehousesList;

  it('says there is no warehouse yet and offers the first one', async () => {
    answer({ '/api/v1/admin/warehouses': () => ({ items: [] }) });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(core['warehouses.noData.title']!)).toBeInTheDocument();
    expect(within(block).getByRole('link', { name: core['warehouses.action.new']! })).toHaveAttribute('href', '/warehouses/new');
    expect(screen.getAllByRole('link', { name: core['warehouses.action.new']! })).toHaveLength(1);
  });

  it('says the search matches nothing, and Clear filters clears it', async () => {
    answer({ '/api/v1/admin/warehouses': () => ({ items: [WAREHOUSE] }) });
    const user = mount(await load());
    await screen.findByText('WH-1');
    await user.type(screen.getByRole('searchbox'), 'zzz');
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-results');
    await user.click(within(block).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(await screen.findByText('WH-1')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});

describe('AvailabilityNotificationsPage', () => {
  const ROW = {
    id: '00000000-0000-4000-8000-0000000000b1',
    productId: '00000000-0000-4000-8000-0000000000f1',
    productName: 'Oak chair',
    productSku: 'SKU-1',
    customerAccountId: null,
    email: 'buyer@example.com',
    status: 'notified',
    queuedAt: '2026-11-01T10:00:00.000Z',
    notifiedAt: '2026-11-02T10:00:00.000Z',
  };
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/inventory/src/admin/pages/AvailabilityNotificationsPage')).AvailabilityNotificationsPage;

  it('says nobody is waiting on the default view', async () => {
    answer({ '/api/v1/admin/inventory/availability-notifications': () => ({ items: [], page: 0, pageSize: 200, total: 0 }) });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(core['inventory.availability.noData.title']!)).toBeInTheDocument();
  });

  it('says the filters match nothing on another status, and Clear filters returns to Queued', async () => {
    answer({
      '/api/v1/admin/inventory/availability-notifications': (url) =>
        url.includes('status=cancelled') ? { items: [], page: 0, pageSize: 200, total: 0 } : { items: [ROW], page: 0, pageSize: 200, total: 1 },
    });
    const user = mount(await load());
    await screen.findByText('Oak chair');
    await user.click(screen.getByRole('button', { name: core['inventory.availability.status.cancelled']! }));
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-results');
    await user.click(within(block).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: core['inventory.availability.status.queued']! })).toHaveAttribute('aria-pressed', 'true'),
    );
  });
});

// ---------------------------------------------------------------------------
// S13 — no bare sentence on a top-level list
// ---------------------------------------------------------------------------

describe('SalesChannelsListPage', () => {
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/sales_channels/src/admin/pages/SalesChannelsListPage')).SalesChannelsListPage;

  it('draws the kit empty state with the create action when there is no channel', async () => {
    answer({ '/api/v1/admin/sales-channels': () => ({ items: [] }) });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByRole('link', { name: salesChannels['list.action.newChannel']! })).toHaveAttribute('href', '/sales-channels/new');
    expect(screen.getAllByRole('link', { name: salesChannels['list.action.newChannel']! })).toHaveLength(1);
  });

  it('says the filter matches nothing when Active only hides every channel', async () => {
    answer({ '/api/v1/admin/sales-channels': () => ({ items: [] }) });
    const user = mount(await load());
    await emptyState();
    await user.click(screen.getByLabelText(salesChannels['list.filter.activeOnly']!));
    await waitFor(() => expect(document.querySelector('[data-empty-state]')?.getAttribute('data-empty-state')).toBe('no-results'));
    const block = document.querySelector('[data-empty-state]') as HTMLElement;
    await user.click(within(block).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(screen.getByLabelText(salesChannels['list.filter.activeOnly']!)).not.toBeChecked();
  });
});

describe('CredentialsPage', () => {
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/credentials/src/admin/pages/CredentialsPage')).CredentialsPage;

  it('draws the kit empty state with the create action', async () => {
    answer({
      '/api/v1/admin/credentials/types': () => ({ types: [{ type: 'api_key', label: 'API key', fields: [] }] }),
      '/api/v1/admin/credentials': () => ({ configurations: [] }),
    });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByRole('button', { name: credentials['page.new']! })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: credentials['page.new']! })).toHaveLength(1);
  });

  it('says why nothing can be created when no module offers a type', async () => {
    answer({
      '/api/v1/admin/credentials/types': () => ({ types: [] }),
      '/api/v1/admin/credentials': () => ({ configurations: [] }),
    });
    mount(await load());
    const block = await emptyState();
    expect(within(block).queryByRole('button')).toBeNull();
    expect(within(block).getByText(credentials['page.emptyNoTypes']!)).toBeInTheDocument();
  });
});

describe('OnlineCustomers', () => {
  it('draws the kit empty state', async () => {
    answer({ '/api/v1/admin/customers/online': () => ({ data: [] }) });
    const { OnlineCustomers } = await import('../../../packages/modules/customers/src/admin/pages/OnlineCustomers');
    mount(OnlineCustomers);
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(customers['online.empty']!)).toBeInTheDocument();
    expect(within(block).getByText(customers['online.emptyBody']!)).toBeInTheDocument();
  });
});

describe('LedgerDeliveriesPage', () => {
  const load = async (): Promise<ComponentType> =>
    (await import('../../../packages/modules/invoice_ledger/src/admin/pages/LedgerDeliveriesPage')).LedgerDeliveriesPage;
  const NONE = { data: [], pagination: { cursor: null, hasMore: false, limit: 50 } };

  it('says there is no delivery yet', async () => {
    answer({ '/api/v1/admin/invoice-ledger/deliveries': () => NONE });
    mount(await load());
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(ledger['deliveries.empty']!)).toBeInTheDocument();
  });

  it('says the status filter matches nothing, and Clear filters resets it', async () => {
    answer({ '/api/v1/admin/invoice-ledger/deliveries': () => NONE });
    const user = mount(await load());
    await emptyState();
    await user.selectOptions(screen.getByRole('combobox'), 'failed');
    await waitFor(() => expect(document.querySelector('[data-empty-state]')?.getAttribute('data-empty-state')).toBe('no-results'));
    const block = document.querySelector('[data-empty-state]') as HTMLElement;
    await user.click(within(block).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});

describe('DictionaryAuditPage', () => {
  it('draws the kit empty state when no reference is orphaned', async () => {
    answer({ '/api/v1/admin/dictionary/audit/orphans': () => ({ data: [], meta: { generatedAt: '2026-11-21T10:00:00.000Z' } }) });
    const { DictionaryAuditPage } = await import('../../../packages/modules/dictionaries/src/admin/pages/AuditPage');
    mount(DictionaryAuditPage);
    const block = await emptyState();
    expect(block.dataset.emptyState).toBe('no-data');
    expect(within(block).getByText(dictionaries['audit.empty']!)).toBeInTheDocument();
    // No empty table frame around it.
    expect(screen.queryByRole('table')).toBeNull();
  });
});
