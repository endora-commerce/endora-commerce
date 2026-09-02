import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

const getSpy = vi.fn();

// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepts
// nothing and vitest reports that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
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

const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');

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
      expect(screen.getByText('#ORD-1')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });
});
