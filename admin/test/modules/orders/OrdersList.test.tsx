import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// usePageSizePreference depends on the AuthProvider; stub it for this UI test.
vi.mock('@/lib/use-page-size-preference', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/use-page-size-preference')>(
    '@/lib/use-page-size-preference',
  );
  return { ...actual, usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }) };
});

const { OrdersList } = await import('../../../src/modules/orders/OrdersList');

const BUNDLE = passthroughBundle('core', [
  'orders.field.search',
  'orders.bulk.changeStatus',
  'orders.bulk.targetStatus',
  'orders.bulk.apply',
]);

function row(id: string, biz: string) {
  return {
    id,
    businessId: biz,
    customerName: 'Jan Kowalski',
    status: 'new',
    statusName: { en: 'New' },
    paymentStatus: 'awaiting_payment',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Acme',
    total: 99.5,
    currency: 'PLN',
    placedAt: '2026-05-22T12:00:00Z',
  };
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return Promise.resolve({
        data: { statuses: [{ code: 'new', name: { en: 'New' } }, { code: 'pending', name: { en: 'Pending' } }] },
      });
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) return Promise.resolve({ data: [] });
    return Promise.resolve({
      data: [row('o1', 'ORD-1'), row('o2', 'ORD-2')],
      pagination: { page: 1, pageSize: 20, total: 2 },
      counts: { new: 2 },
    });
  });
  postSpy.mockResolvedValue({ data: { changed: ['o1'], skipped: [] } });
});

function renderList(): void {
  renderWithI18n(
    <MemoryRouter>
      <OrdersList />
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('OrdersList (desktop)', () => {
  it('renders rows from the server with business IDs and customer names', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());
    expect(screen.getByText('#ORD-2')).toBeInTheDocument();
    expect(screen.getAllByText('Jan Kowalski').length).toBeGreaterThan(0);
  });

  it('sends the search term to the server (debounced)', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('orders.field.search'), 'acme');
    await waitFor(() =>
      expect(getSpy.mock.calls.some(([p]) => typeof p === 'string' && p.includes('q=acme'))).toBe(true),
    );
  });

  it('selects rows and runs a bulk status change', async () => {
    renderList();
    await waitFor(() => expect(screen.getByLabelText('select-ORD-1')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('select-ORD-1'));
    // Bulk bar appears; open the dialog.
    await userEvent.click(screen.getByText('orders.bulk.changeStatus'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pick a target and apply.
    await userEvent.selectOptions(screen.getByLabelText('orders.bulk.targetStatus'), 'pending');
    await userEvent.click(screen.getByText('orders.bulk.apply'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/bulk/status', {
        orderIds: ['o1'],
        toStatusCode: 'pending',
      }),
    );
  });
});
