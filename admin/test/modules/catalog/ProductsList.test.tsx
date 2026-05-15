import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 022 / T041 — interaction test for the streamlined selection
 * toolbar. With Bulk Edit shipping (US1), the Activate / Archive /
 * Add-to-Category buttons were removed from the bulk bar; Bulk Edit,
 * Edit Price, and Delete are the only remaining actions.
 */

const getSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// usePageSizePreference depends on the AuthProvider; for this UI-only
// test we stub it with a stable 25-row preference. The auth tree is
// out of scope for the toolbar contract.
vi.mock('@/lib/use-page-size-preference', () => ({
  PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
  usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
}));

const { ProductsList } = await import('../../../src/modules/catalog/ProductsList');

const BUNDLE = passthroughBundle('catalog', [
  'productsList.title',
  'productsList.description',
  'productsList.action.create',
  'productsList.action.import',
  'productsList.action.export',
  'productsList.action.viewArchived',
  'productsList.bulk.selected',
  'productsList.bulk.edit',
  'productsList.bulk.editPrice',
  'productsList.bulk.delete',
  'productsList.column.product',
  'productsList.column.sku',
  'productsList.column.status',
  'productsList.column.type',
  'productsList.column.visibility',
  'productsList.column.updated',
  'productsList.chip.type',
  'productsList.chip.typeWithValue',
  'productsList.chip.stock',
  'productsList.chip.outOfStock',
  'productsList.chip.lowStock',
  'productsList.chip.category',
  'productsList.chip.channel',
  'productsList.search.placeholder',
  'productsList.empty.title',
  'productsList.empty.suffix',
  'productsList.empty.action',
  'productsList.tab.all',
  'productsList.tab.active',
  'productsList.tab.draft',
  'productsList.tab.archived',
  'productsList.error.load',
]);

const productRow = (id: string, sku: string, name: string): unknown => ({
  id,
  sku,
  slug: sku.toLowerCase(),
  type: 'simple',
  status: 'active',
  name: { 'en-US': name },
  visibility: 'public',
  attributeValues: {},
  updatedAt: '2026-05-15T10:00:00.000Z',
});

describe('ProductsList — streamlined selection toolbar (T041)', () => {
  beforeEach(() => {
    getSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('toolbar appears on selection and contains only Bulk Edit / Edit Price / Delete', async () => {
    getSpy.mockResolvedValue({
      data: [productRow('00000000-0000-4000-8000-000000000a01', 'ROW-A', 'Row A widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, draft: 0, archived: 0 },
    });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    // The product row renders once the list fetch resolves.
    await screen.findByText('Row A widget');

    // Toolbar is initially absent (selected.size === 0).
    expect(screen.queryByText('productsList.bulk.edit')).toBeNull();

    // Click the row's selection checkbox (the second checkbox in the
    // table — the first is the header's select-all).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // [0] = header select-all, [1] = first row, …
    const rowCheckbox = checkboxes[1]!;
    const user = userEvent.setup();
    await user.click(rowCheckbox);

    // Toolbar now renders with the three streamlined actions.
    await waitFor(() =>
      expect(screen.getByText('productsList.bulk.edit')).toBeInTheDocument(),
    );
    expect(screen.getByText('productsList.bulk.editPrice')).toBeInTheDocument();
    expect(screen.getByText('productsList.bulk.delete')).toBeInTheDocument();

    // The removed actions must not be present.
    expect(screen.queryByText('productsList.bulk.activate')).toBeNull();
    expect(screen.queryByText('productsList.bulk.archive')).toBeNull();
    expect(screen.queryByText('productsList.bulk.addToCategory')).toBeNull();
  });

  it('Bulk Edit is the primary (first) action in the toolbar', async () => {
    getSpy.mockResolvedValue({
      data: [productRow('00000000-0000-4000-8000-000000000a02', 'ROW-B', 'Row B widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, draft: 0, archived: 0 },
    });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await screen.findByText('Row B widget');
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const user = userEvent.setup();
    await user.click(checkboxes[1]!);

    const editBtn = await screen.findByText('productsList.bulk.edit');
    const editPriceBtn = screen.getByText('productsList.bulk.editPrice');
    const deleteBtn = screen.getByText('productsList.bulk.delete');

    // DOM-order check: Bulk Edit comes BEFORE Edit Price BEFORE Delete.
    expect(
      editBtn.compareDocumentPosition(editPriceBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      editPriceBtn.compareDocumentPosition(deleteBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
