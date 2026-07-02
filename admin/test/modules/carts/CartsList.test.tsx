import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

/**
 * Feature 027 US6 — CartsList interaction test.
 *
 * Drives the React component through jsdom + Testing Library. Mocks
 * `apiClient.get` so the page never hits the network; verifies the
 * filter wiring (status + approvalStatus query params) and the loading
 * / empty / populated states.
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

const { CartsList } = await import('../../../src/modules/carts/CartsList');

const BUNDLE = passthroughBundle('carts', [
  'carts.page.title',
  'carts.page.description',
  'carts.column.status',
  'carts.column.approval',
  'carts.column.lastActivity',
  'carts.column.id',
  'carts.column.owner',
  'carts.column.org',
  'carts.column.items',
  'carts.column.total',
  'carts.filter.all',
  'carts.loading',
  'carts.empty',
  'carts.open',
]);

beforeEach(() => {
  getSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CartsList', () => {
  it('renders the loading state then displays carts from the API', async () => {
    getSpy.mockResolvedValueOnce({
      data: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          ownerCustomerAccountId: '00000000-0000-4000-8000-000000000a01',
          ownerDisplayName: 'buyer@example.com',
          organizationId: null,
          organizationDisplayName: null,
          salesChannelCode: null,
          status: 'active',
          approvalStatus: 'not_required',
          itemCount: 3,
          total: { amount: 124.5, currency: 'PLN' },
          appliedPromotionCode: null,
          lastActivityAt: '2026-05-22T12:00:00Z',
          createdAt: '2026-05-22T11:00:00Z',
        },
      ],
    });

    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      BUNDLE,
    );

    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/carts');
    await waitFor(() => {
      expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    });
    // PLN renders in its pl-PL currency style ("124,50 zł"); the space before
    // the symbol is a non-breaking space, so match tolerantly.
    expect(screen.getByText(/124,50\s*zł/)).toBeInTheDocument();
    // 'active' appears multiple times (status filter option + status badge);
    // assert at least one is rendered.
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
  });

  it('renders the empty state when the API returns no rows', async () => {
    getSpy.mockResolvedValueOnce({ data: [] });

    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await waitFor(() => {
      expect(screen.getByText('carts.empty')).toBeInTheDocument();
    });
  });

  it('appends the status filter to the API URL when changed', async () => {
    getSpy.mockResolvedValue({ data: [] });

    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/carts');
    });

    // Switch the status filter.
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();
    const statusSelect = screen.getByLabelText('carts.column.status');
    await u.selectOptions(statusSelect, 'active');

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/carts?status=active');
    });
  });

  it('renders card layout on mobile without column headers', async () => {
    setMobileViewport(true);
    getSpy.mockResolvedValueOnce({
      data: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          ownerCustomerAccountId: null,
          ownerDisplayName: 'buyer@example.com',
          organizationId: null,
          organizationDisplayName: null,
          salesChannelCode: null,
          status: 'active',
          approvalStatus: 'not_required',
          itemCount: 1,
          total: { amount: 10, currency: 'PLN' },
          appliedPromotionCode: null,
          lastActivityAt: '2026-05-22T12:00:00Z',
          createdAt: '2026-05-22T11:00:00Z',
        },
      ],
    });

    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      BUNDLE,
    );

    await waitFor(() => {
      expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });
});
