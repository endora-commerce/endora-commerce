import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1624 — the Category, Channel and Stock filters that #1455 (CAT-02)
 * removed because they filtered nothing come back as real filters: each is a
 * labelled select in the kit toolbar, each is sent to the list endpoint, and
 * "select all matching" resolves the selection under the same filters — so a
 * bulk edit or delete never reaches a product the filtered list did not show.
 *
 * - The Channel select appears only when there is more than one channel to choose.
 * - The Stock select appears only while the list says the stock filter is
 *   available (`stockFilterAvailable`, false while `inventory` is off).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const LIST = '/api/v1/admin/catalog/products?';
const LIST_VIEWS = '/api/v1/admin/catalog/products/list-views';
const CATEGORIES = '/api/v1/admin/catalog/categories';
const CHANNELS = '/api/v1/admin/sales-channels';

const TOOLS = '00000000-0000-4000-8000-0000000000c1';
const HAMMERS = '00000000-0000-4000-8000-0000000000c2';
const RETAIL = '00000000-0000-4000-8000-0000000000d1';
const VIP = '00000000-0000-4000-8000-0000000000d2';

const row = (id: string, name: string): unknown => ({
  id,
  sku: `SKU-${id.slice(-4)}`,
  slug: name.toLowerCase(),
  type: 'simple',
  status: 'active',
  name,
  visibility: 'public',
  attributeValues: {},
  updatedAt: '2026-05-15T10:00:00.000Z',
});

function page(stockFilterAvailable: boolean): unknown {
  return {
    data: [row('00000000-0000-4000-8000-000000000b01', 'Hex bolt')],
    // More rows than the page shows, so "select all matching" is offered.
    pagination: { page: 0, pageSize: 25, total: 40 },
    counts: { all: 40, active: 40, inactive: 0, archived: 0 },
    stockFilterAvailable,
  };
}

const BUNDLE = passthroughBundle('catalog', [
  'productsList.title',
  'productsList.toolbar.label',
  'productsList.search.label',
  'productsList.search.placeholder',
  'productsList.filter.type',
  'productsList.filter.typeAll',
  'productsList.filter.category',
  'productsList.filter.categoryAll',
  'productsList.filter.channel',
  'productsList.filter.channelAll',
  'productsList.filter.stock',
  'productsList.filter.stockAll',
  'productsList.filter.stockLow',
  'productsList.filter.stockOut',
  'productsList.bulk.edit',
  'productsList.bulk.delete',
  'productsList.selection.selected',
  'productsList.selection.scopePage',
  'productsList.selection.scopeCollection',
  'productsList.selection.selectAllMatching',
  'productsList.selection.allPageSelected',
  'productsList.selection.clear',
  'productsList.error.load',
  'productsList.tab.all',
  'productsList.tab.active',
  'productsList.tab.inactive',
  'productsList.tab.archived',
]);

function answer(options: { stockFilterAvailable?: boolean; channels?: number } = {}): void {
  const channels = [
    { id: RETAIL, code: 'pl_retail', name: 'Retail' },
    { id: VIP, code: 'pl_b2b_vip', name: 'VIP' },
  ].slice(0, options.channels ?? 2);
  getSpy.mockImplementation(async (path: string) => {
    if (path.startsWith(LIST_VIEWS)) return { data: [] };
    if (path.startsWith(CATEGORIES)) {
      return {
        data: [
          { id: HAMMERS, parentCategoryId: TOOLS, slug: 'hammers', name: { en: 'Hammers' }, sortOrder: 0 },
          { id: TOOLS, parentCategoryId: null, slug: 'tools', name: { en: 'Tools' }, sortOrder: 0 },
        ],
      };
    }
    if (path.startsWith(CHANNELS)) return { items: channels };
    return page(options.stockFilterAvailable ?? true);
  });
}

function mount(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <ProductsList />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['catalog'] }),
      },
    ),
    BUNDLE,
  );
}

function listRequested(fragment: string): boolean {
  return getSpy.mock.calls.some(
    ([path]) => typeof path === 'string' && path.startsWith(LIST) && path.includes(fragment),
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ProductsList — Category, Channel and Stock filters (issue #1624)', () => {
  it('filters by category through a labelled select that shows the tree', async () => {
    answer();
    mount();
    await screen.findByText('Hex bolt');
    const region = screen.getByRole('search', { name: 'productsList.toolbar.label' });
    const category = await within(region).findByRole('combobox', { name: 'productsList.filter.category' });
    await waitFor(() => expect(within(category).getAllByRole('option')).toHaveLength(3));
    const labels = within(category).getAllByRole('option').map((o) => o.textContent);
    // A child reads under its parent, indented, whatever order the API answers in.
    expect(labels).toEqual(['productsList.filter.categoryAll', 'Tools', '— Hammers']);
    await userEvent.selectOptions(category, HAMMERS);
    await waitFor(() => expect(listRequested(`categoryId=${HAMMERS}`)).toBe(true));
  });

  it('filters by sales channel when there is more than one to choose', async () => {
    answer();
    mount();
    await screen.findByText('Hex bolt');
    const channel = await screen.findByRole('combobox', { name: 'productsList.filter.channel' });
    await userEvent.selectOptions(channel, VIP);
    await waitFor(() => expect(listRequested(`salesChannelId=${VIP}`)).toBe(true));
  });

  it('offers no channel filter when there is only one channel', async () => {
    answer({ channels: 1 });
    mount();
    await screen.findByText('Hex bolt');
    await screen.findByRole('combobox', { name: 'productsList.filter.category' });
    expect(screen.queryByRole('combobox', { name: 'productsList.filter.channel' })).toBeNull();
  });

  it('filters by stock state while the list says the stock filter is available', async () => {
    answer();
    mount();
    await screen.findByText('Hex bolt');
    const stock = await screen.findByRole('combobox', { name: 'productsList.filter.stock' });
    expect(within(stock).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'productsList.filter.stockAll',
      'productsList.filter.stockLow',
      'productsList.filter.stockOut',
    ]);
    await userEvent.selectOptions(stock, 'out');
    await waitFor(() => expect(listRequested('stock=out')).toBe(true));
  });

  it('offers no stock filter while the list says it is unavailable', async () => {
    answer({ stockFilterAvailable: false });
    mount();
    await screen.findByText('Hex bolt');
    expect(screen.queryByRole('combobox', { name: 'productsList.filter.stock' })).toBeNull();
  });

  it('"select all matching" resolves the selection under the same filters', async () => {
    answer();
    postSpy.mockResolvedValue({ data: { productIds: ['00000000-0000-4000-8000-000000000b01'], total: 1 } });
    mount();
    await screen.findByText('Hex bolt');
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'productsList.filter.category' }), TOOLS);
    await user.selectOptions(screen.getByRole('combobox', { name: 'productsList.filter.channel' }), RETAIL);
    await user.selectOptions(screen.getByRole('combobox', { name: 'productsList.filter.stock' }), 'low');
    await waitFor(() => expect(listRequested('stock=low')).toBe(true));
    await screen.findByText('Hex bolt');

    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(await screen.findByTestId('select-all-matching'));
    await user.click(screen.getByRole('button', { name: /productsList\.bulk\.edit/ }));

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [path, body] = postSpy.mock.calls[0]!;
    expect(path).toBe('/api/v1/admin/catalog/products/resolve-ids');
    expect(body).toMatchObject({ categoryId: TOOLS, salesChannelId: RETAIL, stock: 'low', archived: 'exclude' });
  });
});
