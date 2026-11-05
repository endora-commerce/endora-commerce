import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #767 — the Organization panel of the admin order detail. A personal
 * (B2C) Organization's tax id is an internal placeholder, so the API answers
 * `taxId: null` and `isPersonal: true` for it and the panel prints
 * "Individual customer" where the tax-id line was; a company
 * Organization's tax id is shown as before.
 */

const getSpy = vi.fn();

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

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const BUNDLE = passthroughBundle('core', ['orderDetail.sections.organization', 'orderDetail.org.taxId', 'orderDetail.org.individualCustomer']);

function answer(organization: Record<string, unknown>): void {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: { ...ORDER, organization } });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['orders', 'payments'] }) },
    ),
    BUNDLE,
  );
}

describe('OrderDetail — Organization panel tax id (#767)', () => {
  beforeEach(() => getSpy.mockReset());

  it("shows a company Organization's tax id", async () => {
    answer({ id: ORDER.organizationId, name: 'Acme', legalName: 'Acme Sp. z o.o.', taxId: '5260250274', isPersonal: false, vatStatus: 'vat_payer' });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.getByText('5260250274')).toBeInTheDocument();
    expect(screen.getByText(/orderDetail\.org\.taxId/)).toBeInTheDocument();
    expect(screen.queryByText('orderDetail.org.individualCustomer')).not.toBeInTheDocument();
  });

  it('labels a personal Organization "Individual customer" where the tax-id line was', async () => {
    answer({ id: ORDER.organizationId, name: 'Jan Kowalski', legalName: null, taxId: null, isPersonal: true, vatStatus: 'vat_exempt' });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Jan Kowalski')).toBeInTheDocument());
    expect(screen.queryByText(/orderDetail\.org\.taxId/)).not.toBeInTheDocument();
    // Owner ruling of 2026-11-05: the line says what the Organization is instead.
    expect(screen.getByText('orderDetail.org.individualCustomer')).toBeInTheDocument();
  });
});
