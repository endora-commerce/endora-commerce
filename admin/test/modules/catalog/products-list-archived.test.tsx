import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import catalog from '../../../../packages/modules/catalog/i18n/en.json';

/**
 * Feature 163, Phase 15a (T156u; FR-113, FR-053; research R30.4; spec Session
 * 2026-10-25, O-2) — the product list on the two-value status model.
 *
 * *All · Active · Inactive* list products that are not archived and *Archived* lists
 * the archived ones: archived is its own axis (`archived=only`), never a status, and
 * archived products are hidden by default — the page no longer sends
 * `includeArchived=1`. A row shows its status and, when archived, an Archived badge
 * beside it. The collection selection asks `resolve-ids` for the same population,
 * and the bulk dialog offers the archive action that changes something on the tab.
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
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');
const { productListTabFromUrl, productListTabQuery, resolveProductSelectionBody } = await import(
  '../../../../packages/modules/catalog/src/admin/lib/resolve-product-selection'
);
const { savedViewTab, savedViewTabFilters } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/ProductsList'
);
const { buildProductBrowserPath } = await import(
  '../../../../packages/admin-kit/src/components/product-browser/product-browser-api'
);

const CATALOG = catalog as Record<string, string>;
const BUNDLE = { core: core as Record<string, string>, catalog: CATALOG };
const t = (key: string, values: Record<string, string | number> = {}): string =>
  (CATALOG[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));

const LIST = '/api/v1/admin/catalog/products?';
const VIEWS = '/api/v1/admin/catalog/products/list-views';

interface Row {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  archivedAt: string | null;
}

const ROWS: Row[] = [
  { id: '00000000-0000-4000-8000-000000000c01', name: 'Oak chair', status: 'active', archivedAt: null },
  { id: '00000000-0000-4000-8000-000000000c02', name: 'Pine desk', status: 'inactive', archivedAt: null },
  { id: '00000000-0000-4000-8000-000000000c03', name: 'Old stool', status: 'active', archivedAt: '2026-10-20T00:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000c04', name: 'Old bench', status: 'inactive', archivedAt: '2026-10-21T00:00:00.000Z' },
];

/** The list's rules (R30.4), so a request and what the screen shows for it agree. */
function serve(path: string): unknown {
  if (path.startsWith(VIEWS)) return { data: [] };
  const params = new URLSearchParams(path.slice(LIST.length));
  expect(params.has('includeArchived')).toBe(false);
  expect(['active', 'inactive', null]).toContain(params.get('status'));
  const archived = params.get('archived') ?? 'exclude';
  const live = ROWS.filter((r) => r.archivedAt === null);
  const gone = ROWS.filter((r) => r.archivedAt !== null);
  const base = archived === 'only' ? gone : live;
  const status = params.get('status');
  const q = (params.get('q') ?? '').toLowerCase();
  const rows = base.filter((r) => (status === null || r.status === status) && r.name.toLowerCase().includes(q));
  return {
    data: rows.map((r) => ({
      id: r.id,
      sku: `SKU-${r.id.slice(-3)}`,
      slug: r.name.toLowerCase().replace(/\s/g, '-'),
      type: 'simple',
      status: r.status,
      archivedAt: r.archivedAt,
      name: r.name,
      visibility: 'public',
      attributeValues: {},
      updatedAt: '2026-10-22T10:00:00.000Z',
    })),
    pagination: { page: 0, pageSize: 20, total: rows.length },
    counts: {
      all: live.length,
      active: live.filter((r) => r.status === 'active').length,
      inactive: live.filter((r) => r.status === 'inactive').length,
      archived: gone.length,
    },
  };
}

function listRequests(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([p]) => String(p))
    .filter((p) => p.startsWith(LIST))
    .map((p) => new URLSearchParams(p.slice(LIST.length)));
}

function renderList(options: { permissions?: readonly string[]; url?: string } = {}): ReturnType<typeof userEvent.setup> {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[options.url ?? '/catalog/products']}>
        <ProductsList />
      </MemoryRouter>,
      { session: adminSession({ permissions: options.permissions ?? ['*'] }) },
    ),
    BUNDLE,
  );
  return userEvent.setup();
}

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation(async (path: string) => serve(path));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProductsList — the Archived filter (FR-113)', () => {
  it('offers All · Active · Inactive · Archived with the counts of R30.4, and hides archived rows by default', async () => {
    renderList();
    await screen.findByText('Oak chair');

    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['All2', 'Active1', 'Inactive1', 'Archived2']);
    expect(screen.queryByRole('tab', { name: /^Draft/ })).toBeNull();
    expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Pine desk')).toBeInTheDocument();
    expect(screen.queryByText('Old stool')).toBeNull();

    const first = listRequests()[0]!;
    expect(first.get('archived')).toBeNull();
    expect(first.get('status')).toBeNull();
  });

  it('a non-archived inactive product is listed like any other, under All and under Inactive', async () => {
    const user = renderList();
    const row = (await screen.findByText('Pine desk')).closest('tr')!;
    expect(within(row).getByText(t('productsList.status.inactive'))).toBeInTheDocument();
    expect(within(row).queryByText(t('productsList.status.archived'))).toBeNull();

    await user.click(tab('Inactive'));
    await waitFor(() => expect(listRequests().at(-1)!.get('status')).toBe('inactive'));
    expect(listRequests().at(-1)!.get('archived')).toBeNull();
    expect(await screen.findByText('Pine desk')).toBeInTheDocument();
  });

  it('the Archived tab asks archived=only and shows each row with its status and an Archived badge', async () => {
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));

    await screen.findByText('Old stool');
    const last = listRequests().at(-1)!;
    expect(last.get('archived')).toBe('only');
    expect(last.get('status')).toBeNull();
    expect(screen.queryByText('Oak chair')).toBeNull();

    // Every row here is archived and the tab says so, so rows carry no Archived
    // pill; the status shows as a neutral outline.
    const stool = screen.getByText('Old stool').closest('tr')!;
    expect(within(stool).getByText(t('productsList.status.active'))).toHaveClass('b2b-badge--outline');
    expect(within(stool).queryByText(t('productsList.status.archived'))).toBeNull();
    const bench = screen.getByText('Old bench').closest('tr')!;
    expect(within(bench).getByText(t('productsList.status.inactive'))).toHaveClass('b2b-badge--outline');
    expect(within(bench).queryByText(t('productsList.status.archived'))).toBeNull();
  });

  it('a bookmarked ?status=archived opens the Archived tab and never sends status=archived', async () => {
    renderList({ url: '/catalog/products?status=archived' });
    await screen.findByText('Old stool');
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true');
    for (const params of listRequests()) {
      expect(params.get('status')).not.toBe('archived');
    }
  });

  it('its own address, /catalog/products/archived, opens the Archived tab (PAL-1)', async () => {
    renderList({ url: '/catalog/products/archived' });
    await screen.findByText('Old stool');
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true');
    expect(listRequests().at(-1)!.get('archived')).toBe('only');
  });

  it('follows the URL after its first load, also back to an address it is already on (PAL-1)', async () => {
    function GoTo(props: { to: string; label: string }): ReactElement {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={(): void => { void navigate(props.to); }}>
          {props.label}
        </button>
      );
    }
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/catalog/products']}>
          <GoTo to="/catalog/products/archived" label="go archived" />
          <GoTo to="/catalog/products?status=inactive" label="go inactive" />
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
    );
    const user = userEvent.setup();
    await screen.findByText('Oak chair');
    expect(tab('All')).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: 'go archived' }));
    await waitFor(() => expect(tab('Archived')).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(listRequests().at(-1)!.get('archived')).toBe('only'));

    // A tab click does not navigate; the palette sending the operator to the same
    // address again still lands on Archived.
    await user.click(tab('All'));
    await user.click(screen.getByRole('button', { name: 'go archived' }));
    await waitFor(() => expect(tab('Archived')).toHaveAttribute('aria-selected', 'true'));

    await user.click(screen.getByRole('button', { name: 'go inactive' }));
    await waitFor(() => expect(tab('Inactive')).toHaveAttribute('aria-selected', 'true'));
  });

  it('a ?status=draft link opens All', async () => {
    renderList({ url: '/catalog/products?status=draft' });
    await screen.findByText('Oak chair');
    expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    expect(listRequests().every((p) => p.get('status') === null)).toBe(true);
  });

  it('says so when nothing is archived', async () => {
    getSpy.mockImplementation(async (path: string) => {
      const answer = serve(path) as { data: unknown[]; counts: Record<string, number> };
      return path.includes('archived=only') ? { ...answer, data: [], pagination: { page: 0, pageSize: 20, total: 0 } } : answer;
    });
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));
    expect(await screen.findByText(t('productsList.empty.archivedTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('productsList.empty.archivedSub'))).toBeInTheDocument();
  });

  it('a filtered, empty Archived tab says "try clearing filters", not "no archived products"', async () => {
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));
    await screen.findByText('Old stool');
    await user.type(screen.getByPlaceholderText(t('productsList.search.placeholder')), 'zzz');
    expect(await screen.findByText(t('productsList.empty.title'))).toBeInTheDocument();
    expect(screen.queryByText(t('productsList.empty.archivedTitle'))).toBeNull();
  });

  it('an empty search elsewhere offers to search archived products, keeping the query', async () => {
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.type(screen.getByPlaceholderText(t('productsList.search.placeholder')), 'stool');
    const hint = await screen.findByRole('button', { name: t('productsList.empty.searchArchived') });
    await user.click(hint);
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Old stool')).toBeInTheDocument();
    const last = listRequests().at(-1)!;
    expect(last.get('archived')).toBe('only');
    expect(last.get('q')).toBe('stool');
    expect(screen.queryByRole('button', { name: t('productsList.empty.searchArchived') })).toBeNull();
  });

  it('no hint without a search', async () => {
    getSpy.mockImplementation(async (path: string) => {
      const answer = serve(path) as Record<string, unknown>;
      return path.startsWith(LIST) ? { ...answer, data: [], pagination: { page: 0, pageSize: 20, total: 0 } } : answer;
    });
    renderList();
    expect(await screen.findByText(t('productsList.empty.title'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('productsList.empty.searchArchived') })).toBeNull();
  });

  it('the tabs are keyboard reachable', async () => {
    const user = renderList();
    await screen.findByText('Oak chair');
    tab('Inactive').focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(tab('Archived'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(listRequests().at(-1)!.get('archived')).toBe('only'));
  });
});

describe('ProductsList — bulk Archive / Restore from the tab (FR-053)', () => {
  function primeDialog(): void {
    getSpy.mockImplementation(async (path: string) => {
      if (path.includes('attributes/by-flag')) return { data: { items: [] } };
      if (path.includes('sales-channels')) return { items: [] };
      if (path.startsWith(LIST) || path.startsWith(VIEWS)) return serve(path);
      return { data: [] };
    });
  }

  async function openBulkEdit(user: ReturnType<typeof userEvent.setup>, rowName: string): Promise<void> {
    const row = (await screen.findByText(rowName)).closest('tr')!;
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: new RegExp(t('productsList.bulk.edit')) }));
  }

  it('offers Archive on the All tab', async () => {
    primeDialog();
    const user = renderList();
    await openBulkEdit(user, 'Oak chair');
    expect(await screen.findByRole('button', { name: t('productsList.bulkEdit.archive.action', { count: 1 }) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('productsList.bulkEdit.restore.action', { count: 1 }) })).toBeNull();
  });

  // Owner decision P-4 → B (2026-10-26): on the Archived tab Restore is the bar's primary
  // action and opens the confirmation directly; the Bulk edit form no longer repeats it.
  it('offers Restore on the Archived tab from the bar, straight to its confirmation', async () => {
    primeDialog();
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));
    const row = (await screen.findByText('Old stool')).closest('tr')!;
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: new RegExp(`^${t('productsList.bulk.restore')}`) }));
    const dialog = await screen.findByRole('dialog', { name: t('productsList.bulkEdit.restore.confirmTitle', { count: 1 }) });
    expect(within(dialog).getByRole('button', { name: t('productsList.bulkEdit.restore.confirm', { count: 1 }) })).toBeInTheDocument();
    // No form behind it: the way out is Cancel, and it closes the dialog.
    await user.click(within(dialog).getByRole('button', { name: t('productsList.bulkEdit.action.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores from the bar with archived: false and shows the summary', async () => {
    primeDialog();
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-r',
        summary: { succeeded: 1, skipped: 0, failed: 0, total: 1 },
        results: [{ productId: '00000000-0000-4000-8000-000000000c03', status: 'succeeded', changedFields: ['archivedAt'] }],
      },
    });
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));
    const row = (await screen.findByText('Old stool')).closest('tr')!;
    await user.click(within(row).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: new RegExp(`^${t('productsList.bulk.restore')}`) }));
    await user.click(await screen.findByRole('button', { name: t('productsList.bulkEdit.restore.confirm', { count: 1 }) }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect((postSpy.mock.calls[0]![1] as { fields: unknown }).fields).toEqual({ archived: false });
    expect(await screen.findByRole('heading', { name: t('productsList.bulkEdit.restore.done', { count: 1 }) })).toBeInTheDocument();
  });

  it('the Bulk edit form on the Archived tab does not repeat Restore', async () => {
    primeDialog();
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(tab('Archived'));
    await openBulkEdit(user, 'Old stool');
    await screen.findByRole('checkbox', { name: new RegExp(`^${t('productsList.bulkEdit.section.status')}`) });
    expect(screen.queryByRole('button', { name: t('productsList.bulkEdit.restore.action', { count: 1 }) })).toBeNull();
    expect(screen.queryByRole('button', { name: t('productsList.bulkEdit.archive.action', { count: 1 }) })).toBeNull();
  });

  it('offers neither to an operator without catalog:write', async () => {
    primeDialog();
    const user = renderList({ permissions: ['catalog:read'] });
    await openBulkEdit(user, 'Oak chair');
    await screen.findByRole('checkbox', { name: new RegExp(`^${t('productsList.bulkEdit.section.status')}`) });
    expect(screen.queryByRole('button', { name: t('productsList.bulkEdit.archive.action', { count: 1 }) })).toBeNull();
  });
});

describe('the URL → tab mapping (pure, PAL-1)', () => {
  it('reads the Archived path, then ?status=, else All', () => {
    expect(productListTabFromUrl('/catalog/products/archived', '')).toBe('archived');
    expect(productListTabFromUrl('/catalog/products/archived/', '?status=active')).toBe('archived');
    expect(productListTabFromUrl('/catalog/products', '?status=inactive')).toBe('inactive');
    expect(productListTabFromUrl('/catalog/products', '?status=archived')).toBe('archived');
    expect(productListTabFromUrl('/catalog/products', '?status=draft')).toBe('all');
    expect(productListTabFromUrl('/catalog/products', '')).toBe('all');
  });
});

describe('the tab → request mapping (pure)', () => {
  it('maps every tab onto status and the archived mode, never status=archived', () => {
    expect(productListTabQuery('all')).toEqual({ archived: 'exclude' });
    expect(productListTabQuery('active')).toEqual({ status: 'active', archived: 'exclude' });
    expect(productListTabQuery('inactive')).toEqual({ status: 'inactive', archived: 'exclude' });
    expect(productListTabQuery('archived')).toEqual({ archived: 'only' });
  });

  it('the product browser asks the list exactly what the Products list asks, tab for tab (no drift)', () => {
    for (const tab of ['all', 'active', 'inactive', 'archived'] as const) {
      const fromList = productListTabQuery(tab);
      const params = new URLSearchParams(
        buildProductBrowserPath({ page: 0, pageSize: 10, status: tab, type: null, q: '' }).split('?')[1],
      );
      expect(params.get('status')).toBe(fromList.status ?? null);
      // The browser leaves `exclude` to the list's default; the meaning is the same.
      expect(params.get('archived') ?? 'exclude').toBe(fromList.archived);
      expect(params.has('includeArchived')).toBe(false);
    }
  });

  it('resolve-ids always names the archived mode — its own default is include', () => {
    expect(resolveProductSelectionBody({ status: 'all', type: 'all', q: '' })).toEqual({ archived: 'exclude' });
    expect(resolveProductSelectionBody({ status: 'inactive', type: 'simple', q: ' chair ' })).toEqual({
      archived: 'exclude',
      status: 'inactive',
      type: 'simple',
      q: 'chair',
    });
    expect(resolveProductSelectionBody({ status: 'archived', type: 'all', q: '' })).toEqual({ archived: 'only' });
  });

  it('a saved view keeps the Archived tab as its own key, and a removed status opens All', () => {
    expect(savedViewTabFilters('archived')).toEqual({ archived: 'only' });
    expect(savedViewTabFilters('inactive')).toEqual({ status: 'inactive' });
    expect(savedViewTabFilters('all')).toEqual({});
    expect(savedViewTab({ archived: 'only' })).toBe('archived');
    expect(savedViewTab({ status: 'inactive' })).toBe('inactive');
    expect(savedViewTab({ status: 'draft' })).toBe('all');
    expect(savedViewTab({ status: 'archived' })).toBe('all');
  });
});

describe('the collection selection (FR-113)', () => {
  it('select all matching on the All tab resolves non-archived products only', async () => {
    postSpy.mockResolvedValue({ data: { productIds: [ROWS[0]!.id, ROWS[1]!.id], total: 2 } });
    getSpy.mockImplementation(async (path: string) => {
      if (path.startsWith(VIEWS)) return { data: [] };
      if (path.includes('attributes/by-flag')) return { data: { items: [] } };
      if (path.includes('sales-channels')) return { items: [] };
      if (!path.startsWith(LIST)) return { data: [] };
      const answer = serve(path) as { pagination: { total: number } };
      // More matching than shown, so the "select all matching" banner appears.
      return { ...answer, pagination: { ...answer.pagination, total: 40 } };
    });
    const user = renderList();
    await screen.findByText('Oak chair');
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(await screen.findByTestId('select-all-matching'));
    await user.click(screen.getByRole('button', { name: new RegExp(t('productsList.bulk.edit')) }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/resolve-ids', { archived: 'exclude' }),
    );
  });
});
