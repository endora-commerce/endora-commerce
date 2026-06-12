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

// OrganizationPicker pulls in useOrganizationsQuery → usePageSizePreference →
// useAuth, which needs an AuthProvider this layout-only test doesn't mount.
// Stub it out — this test only asserts the mobile card layout, not the picker.
vi.mock('@/components/organization-picker/OrganizationPicker', () => ({
  OrganizationPicker: () => null,
}));

const { RfqList } = await import('../../../src/modules/quote_requests/RfqList');

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
