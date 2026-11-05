import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 (review D3) — the bulk dialog names the products it reports by name and
 * SKU. The list hands it the names and SKUs of the selected rows it already shows, so a
 * page selection needs no lookup (the dialog looks up only what is missing).
 */

const getSpy = vi.fn();
const dialogProps = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog',
  );
  return {
    ...actual,
    ProductsBulkEditDialog: (props: unknown): null => {
      dialogProps(props);
      return null;
    },
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const A = '00000000-0000-4000-8000-0000000000d1';
const B = '00000000-0000-4000-8000-0000000000d2';
const row = (id: string, name: string, sku: string): unknown => ({
  id,
  sku,
  slug: name.toLowerCase(),
  type: 'simple',
  status: 'active',
  name,
  visibility: 'public',
  attributeValues: {},
  updatedAt: '2026-05-15T10:00:00.000Z',
});

beforeEach(() => {
  getSpy.mockReset();
  dialogProps.mockReset();
  getSpy.mockImplementation(async (path: string) =>
    path.startsWith('/api/v1/admin/catalog/products/list-views')
      ? { data: [] }
      : {
          data: [row(A, 'Alpha', 'SKU-A'), row(B, 'Beta', 'SKU-B')],
          pagination: { page: 0, pageSize: 20, total: 2 },
          counts: { all: 2, active: 2, inactive: 0, archived: 0 },
        },
  );
});
afterEach(() => vi.clearAllMocks());

describe('ProductsList hands the bulk dialog the names it shows (D3)', () => {
  it('passes name and SKU of every selected row', async () => {
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ProductsList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      passthroughBundle('catalog', ['productsList.bulk.edit']),
    );
    await screen.findByText('Alpha');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[1]!);
    await user.click(await screen.findByRole('button', { name: /productsList\.bulk\.edit$/ }));
    await waitFor(() => expect(dialogProps).toHaveBeenCalled());
    const props = dialogProps.mock.calls.at(-1)![0] as { productIds: string[]; productLabels?: unknown };
    expect(props.productIds).toEqual([A]);
    expect(props.productLabels).toEqual({ [A]: { name: 'Alpha', sku: 'SKU-A' } });
  });
});
