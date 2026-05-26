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

const { OrdersList } = await import('../../../src/modules/orders/OrdersList');

const BUNDLE = passthroughBundle('core', [
  'orders.page.title',
  'orders.page.description',
  'orders.field.status',
  'orders.filter.all',
  'orders.column.order',
  'orders.column.org',
  'orders.column.status',
  'orders.column.payment',
  'orders.column.total',
  'orders.loading',
  'orders.empty',
  'orders.open',
]);

beforeEach(() => {
  setMobileViewport(true);
  getSpy.mockReset();
  getSpy.mockResolvedValue({
    data: [
      {
        id: '00000000-0000-4000-8000-0000000000o1',
        status: 'new',
        paymentStatus: 'unpaid',
        organizationId: '00000000-0000-4000-8000-0000000000a1',
        total: 99.5,
        currency: 'PLN',
        placedAt: '2026-05-22T12:00:00Z',
      },
    ],
  });
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
      expect(screen.getByText('orders.open')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });
});
