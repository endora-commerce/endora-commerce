import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { BULK_EDIT_HARD_MAX } from '../../../../packages/modules/catalog/src/admin/lib/resolve-product-selection';

const getSpy = vi.fn();
const postSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
//
// The `usePageSizePreference` stub is folded into this one factory rather than kept
// beside it: both shims re-export from the same kit barrel, so two `vi.mock`
// calls naming `@endora-commerce/admin-kit/lib` would be one module mocked
// twice, with the last factory silently replacing the first.
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
    PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
    usePageSizePreference: () => ({ pageSize: 2 as const, setPageSize: vi.fn() }),
  };
});


const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const BUNDLE = passthroughBundle('catalog', [
  'productsList.title',
  'productsList.subtitle',
  'productsList.tab.all',
  'productsList.tab.active',
  'productsList.tab.draft',
  'productsList.tab.archived',
  'productsList.search.placeholder',
  'productsList.chip.type',
  'productsList.chip.stock',
  'productsList.chip.category',
  'productsList.chip.channel',
  'productsList.loading',
  'productsList.bulk.edit',
  'productsList.bulk.editPrice',
  'productsList.bulk.delete',
  'productsList.selection.selected',
  'productsList.selection.scopePage',
  'productsList.selection.scopeCollection',
  'productsList.selection.selectAllMatching',
  'productsList.selection.allPageSelected',
  'productsList.selection.bulkEditHardLimit',
  'productsList.error.load',
]);

const row = (id: string, name: string): unknown => ({
  id,
  sku: `SKU-${id.slice(-4)}`,
  slug: name.toLowerCase().replace(/\s/g, '-'),
  type: 'simple',
  status: 'active',
  name: { 'en-US': name },
  visibility: 'public',
  attributeValues: {},
  updatedAt: '2026-05-15T10:00:00.000Z',
});

describe('ProductsList — collection selection (feature 033)', () => {
  beforeEach(() => {
    getSpy.mockReset();
    postSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows select-all-matching banner and switches to collection scope', async () => {
    getSpy.mockResolvedValue({
      data: [row('00000000-0000-4000-8000-000000000001', 'Alpha'), row('00000000-0000-4000-8000-000000000002', 'Beta')],
      pagination: { page: 0, pageSize: 2, total: 5 },
      counts: { all: 5, active: 5, draft: 0, archived: 0 },
    });
    postSpy.mockResolvedValue({
      data: {
        productIds: [
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000004',
          '00000000-0000-4000-8000-000000000005',
        ],
        total: 5,
      },
    });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await screen.findByText('Alpha');
    const user = userEvent.setup();
    const headerCheckbox = screen.getAllByRole('checkbox')[0]!;
    await user.click(headerCheckbox);

    await waitFor(() =>
      expect(screen.getByText('productsList.selection.selectAllMatching')).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId('select-all-matching'));

    await waitFor(() =>
      expect(screen.getByTestId('selection-summary').textContent).toContain(
        'productsList.selection.scopeCollection',
      ),
    );
  });

  it('page-only selection shows scopePage count without resolve on bulk edit', async () => {
    getSpy.mockResolvedValue({
      data: [row('00000000-0000-4000-8000-00000000000a', 'Solo')],
      pagination: { page: 0, pageSize: 2, total: 1 },
      counts: { all: 1, active: 1, draft: 0, archived: 0 },
    });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await screen.findByText('Solo');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[1]!);

    await waitFor(() =>
      expect(screen.getByText(/productsList\.selection\.scopePage/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('productsList.selection.selectAllMatching')).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('blocks bulk edit when the collection exceeds the hard maximum', async () => {
    // Below the hard maximum, large selections are delegated to a background
    // bulk operation rather than rejected; only the contract hard maximum is
    // enforced client-side.
    const overLimit = BULK_EDIT_HARD_MAX + 1;
    const manyIds = Array.from({ length: overLimit }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    getSpy.mockResolvedValue({
      data: [
        row('00000000-0000-4000-8000-000000000001', 'One'),
        row('00000000-0000-4000-8000-000000000002', 'Two'),
      ],
      pagination: { page: 0, pageSize: 2, total: overLimit },
      counts: { all: overLimit, active: overLimit, draft: 0, archived: 0 },
    });
    postSpy.mockResolvedValue({ data: { productIds: manyIds, total: overLimit } });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await screen.findByText('One');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await screen.findByTestId('select-all-matching');
    await user.click(screen.getByTestId('select-all-matching'));
    await user.click(screen.getByText('productsList.bulk.edit'));

    await waitFor(() =>
      expect(screen.getByText('productsList.selection.bulkEditHardLimit')).toBeInTheDocument(),
    );
  });
});
