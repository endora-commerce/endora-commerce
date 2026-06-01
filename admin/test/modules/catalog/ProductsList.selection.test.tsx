import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
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
  };
});

vi.mock('@/lib/use-page-size-preference', () => ({
  PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
  usePageSizePreference: () => ({ pageSize: 2 as const, setPageSize: vi.fn() }),
}));

const { ProductsList } = await import('../../../src/modules/catalog/ProductsList');

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
  'productsList.selection.bulkEditLimit',
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

  it('blocks bulk edit when collection resolves to more than 200 ids', async () => {
    const manyIds = Array.from({ length: 201 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    getSpy.mockResolvedValue({
      data: [
        row('00000000-0000-4000-8000-000000000001', 'One'),
        row('00000000-0000-4000-8000-000000000002', 'Two'),
      ],
      pagination: { page: 0, pageSize: 2, total: 250 },
      counts: { all: 250, active: 250, draft: 0, archived: 0 },
    });
    postSpy.mockResolvedValue({ data: { productIds: manyIds, total: 201 } });

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
      expect(screen.getByText('productsList.selection.bulkEditLimit')).toBeInTheDocument(),
    );
  });
});
