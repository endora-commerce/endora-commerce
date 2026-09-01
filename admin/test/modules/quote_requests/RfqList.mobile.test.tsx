import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

const getSpy = vi.fn();

/**
 * The **kit's** barrel, not the four `@/lib/*` and `@/components/*` paths this
 * file used to name. The screen is
 * `@endora-commerce/mod-quote-requests/admin`'s since feature 091's batch 12
 * and resolves `apiClient`, `useAuth` and `usePageSizePreference` there; the
 * admin's own paths are re-export shims of the same bindings, so mocking a shim
 * would leave the module the screen actually imports untouched — and `useAuth`
 * would throw `useAuth must be used inside <AuthProvider>`, which is what it
 * did.
 *
 * `useAuth` and `usePageSizePreference` are stubbed for the reason they always
 * were: this is a layout-only test with no `AuthProvider` mounted, which is the
 * pattern `OrdersList.mobile` and `AppShell.mobile` follow.
 */
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
    useAuth: () => ({ me: { role: { code: 'platform_admin' } } }),
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});

// `OrganizationPicker` pulls the same chain and is the kit's since P2, so the
// stub names the kit's `components` barrel for the same reason.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, OrganizationPicker: () => null };
});

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');

const BUNDLE = passthroughBundle('core', [
  'rfq.list.title',
  'rfq.list.description',
  'rfq.list.field.visibility',
  'rfq.list.scope.mine',
  'rfq.list.scope.unassigned',
  'rfq.list.scope.all',
  'rfq.list.field.status',
  'rfq.list.field.organizationId',
  'rfq.list.field.uuid',
  'rfq.list.refresh',
  'rfq.list.column.rfq',
  'rfq.list.column.organization',
  'rfq.list.column.customer',
  'rfq.list.column.status',
  'rfq.list.column.lines',
  'rfq.list.column.total',
  'rfq.list.statusFilter.all',
  'rfq.list.open',
]);

beforeEach(() => {
  setMobileViewport(true);
  getSpy.mockReset();
  getSpy.mockResolvedValue({
    data: [
      {
        id: '00000000-0000-4000-8000-0000000000r1',
        organizationId: '00000000-0000-4000-8000-0000000000a1',
        organizationName: 'Acme',
        customerAccountId: '00000000-0000-4000-8000-0000000000c1',
        customerDisplayName: 'Buyer',
        status: 'Pending',
        awaitingCustomerRevisionAcceptance: false,
        lineCount: 2,
        totalAtCustomerPrice: 100,
        totalAtAgreedPrice: null,
        currency: 'PLN',
        updatedAt: '2026-05-22T12:00:00Z',
      },
    ],
  });
});

describe('RfqList mobile', () => {
  it('renders card layout without table column headers', async () => {
    renderWithI18n(
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>,
      BUNDLE,
    );
    await waitFor(() => {
      expect(screen.getByText('rfq.list.open')).toBeInTheDocument();
    });
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });
});
