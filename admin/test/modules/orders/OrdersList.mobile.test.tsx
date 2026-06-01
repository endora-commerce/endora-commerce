import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

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

// usePageSizePreference depends on the AuthProvider; stub it for this UI test.
vi.mock('@/lib/use-page-size-preference', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/use-page-size-preference')>(
    '@/lib/use-page-size-preference',
  );
  return { ...actual, usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }) };
});

const { OrdersList } = await import('../../../src/modules/orders/OrdersList');

const BUNDLE = passthroughBundle('core', []);

// Dispatch the three GETs OrdersList issues: status graph, saved views, list.
function wireGet(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' } }] } });
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({
      data: [
        {
          id: '00000000-0000-4000-8000-0000000000o1',
          businessId: 'ORD-1',
          customerName: 'Jan Kowalski',
          status: 'new',
          statusName: { en: 'New' },
          paymentStatus: 'awaiting_payment',
          organizationId: '00000000-0000-4000-8000-0000000000a1',
          organizationName: 'Acme',
          total: 99.5,
          currency: 'PLN',
          placedAt: '2026-05-22T12:00:00Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1 },
      counts: { new: 1 },
    });
  });
}

beforeEach(() => {
  setMobileViewport(true);
  getSpy.mockReset();
  wireGet();
});

describe('OrdersList mobile', () => {
  it('renders card layout without table column headers', async () => {
    renderWithI18n(
      <MemoryRouter>
        <OrdersList />
      </MemoryRouter>,
      BUNDLE,
    );
    await waitFor(() => {
      expect(screen.getByText('ORD-1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });
});
