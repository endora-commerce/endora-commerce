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
const deleteSpy = vi.fn();

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
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
    PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

// usePageSizePreference depends on the AuthProvider; for this UI-only
// test we stub it with a stable 25-row preference. The auth tree is
// out of scope for the toolbar contract.

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

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
  'productsList.bulk.deleteConfirm',
  'productsList.bulk.deleteFailed',
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
  'productsList.tab.inactive',
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
    deleteSpy.mockReset();
    deleteSpy.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('toolbar appears on selection and contains only Bulk Edit / Edit Price / Delete', async () => {
    getSpy.mockResolvedValue({
      data: [productRow('00000000-0000-4000-8000-000000000a01', 'ROW-A', 'Row A widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, draft: 0, inactive: 0 },
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
      counts: { all: 1, active: 1, draft: 0, inactive: 0 },
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

  it('Delete calls DELETE for each selected product after confirm', async () => {
    const id = '00000000-0000-4000-8000-000000000a03';
    getSpy.mockResolvedValue({
      data: [productRow(id, 'ROW-C', 'Row C widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, draft: 0, inactive: 0 },
    });

    renderWithI18n(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await screen.findByText('Row C widget');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(await screen.findByText('productsList.bulk.delete'));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${id}`);
    });
  });
});
