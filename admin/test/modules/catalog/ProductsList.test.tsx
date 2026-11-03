import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
// The session provider arrives with D-221: `ProductsList` gates its two
// *New product* affordances on `catalog:write` through `useAuth`, which throws
// outside `<AuthProvider>`. The wildcard is deliberate — this file's subject is
// not the permission gate, and `adminSession` documents `['*']` as the value
// for exactly that. The gate itself is
// `admin/test/modules/catalog/ProductsList.create-affordance-gating.test.tsx`.
import { adminSession, withSession } from '../../helpers/render-with-session';

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

// Feature 147 (#289): the page mounts the kit's saved-views control, which
// requests its own list on mount. It answers no views here — this file's
// subject is not saved views (`ProductsList.saved-views.test.tsx` is) — and the
// product payload keeps answering every other request, as before.
const LIST_VIEWS = '/api/v1/admin/catalog/products/list-views';
function answerList(response: unknown): void {
  getSpy.mockImplementation(async (path: string) =>
    typeof path === 'string' && path.startsWith(LIST_VIEWS) ? { data: [] } : response,
  );
}

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
  'productsList.bulk.editPriceUnavailable',
  'productsList.bulk.restore',
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
  'productsList.tab.inactive',
  'productsList.error.load',
]);

const productRow = (id: string, sku: string, name: string): unknown => ({
  id,
  sku,
  slug: sku.toLowerCase(),
  type: 'simple',
  status: 'active',
  name,
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
    answerList({
      data: [productRow('00000000-0000-4000-8000-000000000a01', 'ROW-A', 'Row A widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, inactive: 0, archived: 0 },
    });

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
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
    // D17 — Edit price has no flow behind it (prices live in price books): it is
    // disabled and says why, rather than a button that does nothing.
    const editPrice = screen.getByRole('button', { name: /productsList\.bulk\.editPrice/ });
    expect(editPrice).toBeDisabled();
    expect(document.getElementById(editPrice.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'productsList.bulk.editPriceUnavailable',
    );
    expect(screen.getByText('productsList.bulk.delete')).toBeInTheDocument();

    // The removed actions must not be present.
    expect(screen.queryByText('productsList.bulk.activate')).toBeNull();
    expect(screen.queryByText('productsList.bulk.archive')).toBeNull();
    expect(screen.queryByText('productsList.bulk.addToCategory')).toBeNull();
  });

  it('Bulk Edit is the primary (first) action in the toolbar', async () => {
    answerList({
      data: [productRow('00000000-0000-4000-8000-000000000a02', 'ROW-B', 'Row B widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, inactive: 0, archived: 0 },
    });

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
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

  // Feature 163, owner decision P-4 → B (2026-10-26). The bar keeps three actions on every
  // tab, but on the Archived tab they are Restore (primary) / Bulk edit / Delete: bringing
  // archived products back is what that selection is for, and the placeholder Edit price
  // has nothing to do there. The two cases above still hold the other tabs to Bulk edit /
  // Edit price / Delete.
  it('on the Archived tab the bar is Restore (primary) / Bulk edit / Delete — no Edit price', async () => {
    answerList({
      data: [{ ...(productRow('00000000-0000-4000-8000-000000000a09', 'ROW-Z', 'Row Z widget') as object), archivedAt: '2026-10-20T00:00:00.000Z' }],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 0, active: 0, inactive: 0, archived: 1 },
    });

    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/catalog/products?status=archived']}>
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
    );

    await screen.findByText('Row Z widget');
    const user = userEvent.setup();
    await user.click((screen.getAllByRole('checkbox') as HTMLInputElement[])[1]!);

    const restoreBtn = (await screen.findByText('productsList.bulk.restore')).closest('button')!;
    const editBtn = screen.getByText('productsList.bulk.edit').closest('button')!;
    const deleteBtn = screen.getByText('productsList.bulk.delete').closest('button')!;
    expect(screen.queryByText('productsList.bulk.editPrice')).toBeNull();
    expect(restoreBtn.className).toContain('b2b-btn--primary');
    expect(editBtn.className).not.toContain('b2b-btn--primary');
    expect(restoreBtn.compareDocumentPosition(editBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editBtn.compareDocumentPosition(deleteBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Delete calls DELETE for each selected product after confirm', async () => {
    const id = '00000000-0000-4000-8000-000000000a03';
    answerList({
      data: [productRow(id, 'ROW-C', 'Row C widget')],
      pagination: { page: 0, pageSize: 25, total: 1 },
      counts: { all: 1, active: 1, inactive: 0, archived: 0 },
    });

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
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
