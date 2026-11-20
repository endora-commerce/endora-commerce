import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 027 US6 — CartsList interaction test.
 *
 * Drives the React component through jsdom + Testing Library. Mocks
 * `apiClient.get` so the page never hits the network; verifies the
 * filter wiring (status + approvalStatus query params) and the loading
 * / empty / populated states.
 */

const getSpy = vi.fn();

// The kit's `lib` barrel, not `@/lib/api-client`: the screen is a package's now
// and resolves `apiClient` through `@endora-commerce/admin-kit/lib`, which is
// the same module specifier the admin application resolves, so one mock covers
// both. Keyed on the specifier the component actually imports — `vi.mock` keys
// on a resolved module id, and the old key would have silently mocked nothing.
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
      delete: vi.fn(),
    },
  };
});

/**
 * The screen lives in `packages/modules/carts/src/admin/` since feature 091's
 * Phase 4 batch four, so it takes `apiClient` from the published kit and is
 * reached here through the **route factory the module declares** — the same
 * entry point `admin/src/App.tsx` uses. Importing the package's source instead
 * would evaluate a second copy of it beside its `dist`; going through
 * `contributions.routes` also makes this test fail if the declaration ever
 * stops naming the screen, which is the coupling the move creates.
 */
const { contributions } = await import('@endora-commerce/mod-carts/admin');
const CartsList = (await contributions.routes![0]!.component())
  .default as () => ReactNode;

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
  'carts.filter.allStatuses',
  'carts.filter.allApprovals',
  'carts.toolbar.label',
  'carts.empty',
  'carts.emptyFiltered',
  'carts.emptyTitle',
  'carts.count',
  'carts.status.active',
  'carts.status.abandoned',
  'carts.status.completed',
  'carts.status.rejected',
  'carts.approvalStatus.not_required',
  'carts.approvalStatus.pending',
  'carts.approvalStatus.approved',
  'carts.approvalStatus.rejected_by_org_admin',
]);

// The list remembers its page size as the signed-in admin's preference
// (issue #1473), so it renders under the real session provider.
const session = adminSession({ permissions: ['*'] });
const page = (data: unknown[], totalCount = data.length) => ({
  data,
  meta: { page: 1, pageSize: 20, totalCount },
});
const FIRST_PAGE = '/api/v1/admin/carts?page=1&pageSize=20';

beforeEach(() => {
  getSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CartsList', () => {
  it('renders the loading state then displays carts from the API', async () => {
    getSpy.mockResolvedValueOnce(page([
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
      ]),
    );

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );

    expect(getSpy).toHaveBeenCalledWith(FIRST_PAGE);
    await waitFor(() => {
      expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    });
    // PLN renders in its pl-PL currency style ("124,50 zł"); the space before
    // the symbol is a non-breaking space, so match tolerantly.
    expect(screen.getByText(/124,50\s*zł/)).toBeInTheDocument();
    // The status label appears twice (filter option + status badge), and it is
    // the catalogue's label, never the raw code (issue #1368).
    expect(screen.getAllByText('carts.status.active').length).toBeGreaterThan(0);
    expect(screen.queryByText('active')).toBeNull();
  });

  it('renders the empty state when the API returns no rows', async () => {
    getSpy.mockResolvedValueOnce(page([]));

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );

    await waitFor(() => {
      expect(screen.getByText('carts.empty')).toBeInTheDocument();
    });
  });

  it('appends the status filter to the API URL when changed', async () => {
    getSpy.mockResolvedValue(page([]));

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(FIRST_PAGE);
    });

    // Switch the status filter.
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();
    const statusSelect = screen.getByLabelText('carts.column.status');
    await u.selectOptions(statusSelect, 'active');

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/carts?status=active&page=1&pageSize=20');
    });
  });

  it('renders card layout on mobile without column headers', async () => {
    setMobileViewport(true);
    getSpy.mockResolvedValueOnce(page([
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
      ]),
    );

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );

    await waitFor(() => {
      expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  // Issue #1473 (UX audit SALES-08) — the API always paged; the screen asked
  // for nothing and showed the first 50 carts, with no way to the 51st.
  it('pages through the carts with the pager, asking the API for each page', async () => {
    const row = (n: number) => ({
      id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
      ownerCustomerAccountId: null,
      ownerDisplayName: `buyer-${n}@example.com`,
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
    });
    getSpy.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('page=2')
          ? { data: [row(21)], meta: { page: 2, pageSize: 20, totalCount: 21 } }
          : { data: [row(1)], meta: { page: 1, pageSize: 20, totalCount: 21 } },
      ),
    );
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();

    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );

    await screen.findByText('buyer-1@example.com');
    expect(screen.getByRole('status')).toHaveTextContent('carts.count');
    await u.click(screen.getByRole('button', { name: /common\.pagination\.next/ }));
    await screen.findByText('buyer-21@example.com');
    expect(getSpy).toHaveBeenLastCalledWith('/api/v1/admin/carts?page=2&pageSize=20');
  });

  it('goes back to the first page when a filter changes', async () => {
    getSpy.mockResolvedValue(page([], 0));
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(FIRST_PAGE));
    await u.selectOptions(screen.getByLabelText('carts.column.approval'), 'pending');
    await waitFor(() => {
      expect(getSpy).toHaveBeenLastCalledWith('/api/v1/admin/carts?approvalStatus=pending&page=1&pageSize=20');
    });
  });

  it('tells "no carts yet" from "no cart matches", and clears the filters from the empty state', async () => {
    getSpy.mockResolvedValue(page([], 0));
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );
    await screen.findByText('carts.empty');
    expect(screen.queryByRole('button', { name: /emptyState\.clearFilters/ })).toBeNull();

    await u.selectOptions(screen.getByLabelText('carts.column.status'), 'abandoned');
    await screen.findByText('carts.emptyFiltered');
    await u.click(screen.getByRole('button', { name: /emptyState\.clearFilters/ }));
    await screen.findByText('carts.empty');
    expect(screen.getByLabelText('carts.column.status')).toHaveValue('');
    expect(getSpy).toHaveBeenLastCalledWith(FIRST_PAGE);
  });

  it('offers a retry when the list cannot be loaded', async () => {
    getSpy.mockRejectedValueOnce(new Error('network down')).mockResolvedValue(page([], 0));
    const userEvent = (await import('@testing-library/user-event')).default;
    const u = userEvent.setup();
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <CartsList />
        </MemoryRouter>,
        { session },
      ),
      BUNDLE,
    );
    const alert = await screen.findByRole('alert');
    // No server message to show, so the kit's own copy — never the raw error.
    expect(alert).not.toHaveTextContent('network down');
    await u.click(within(alert).getByRole('button'));
    await screen.findByText('carts.empty');
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
