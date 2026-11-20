import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `specs/182-related-payers/` T042 (FR-073) — the operator sees who pays: a *Payer* line in the
 * order detail's billing card, from the order's own `payer` field (order data, no zone), and
 * a payer filter on the orders list sent to the server as `payerOrganizationId`.
 */
const getSpy = vi.fn();
const PAYER_ID = '00000000-0000-4000-8000-0000000000b2';

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: ({ onChange, ariaLabel }: { onChange: (id: string | null) => void; ariaLabel?: string }) => (
      <button type="button" aria-label={ariaLabel} onClick={() => onChange(PAYER_ID)}>
        pick-payer
      </button>
    ),
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');
const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL', companyName: 'Payer SA', taxId: 'PL1234567890' },
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
  organization: null,
  customer: null,
};

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
});

describe('order detail — Payer (FR-073)', () => {
  function renderDetail(order: Record<string, unknown>): void {
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: order });
      if (path === '/api/v1/admin/orders/statuses') {
        return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
      }
      return Promise.resolve({ data: [] });
    });
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/orders/o1']}>
          <Routes>
            <Route path="/orders/:id" element={<OrderDetail />} />
          </Routes>
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['orders'] }) },
      ),
      { orders: { 'orderDetail.payer': 'Payer', 'orderDetail.payerTerms.buyer': "buyer's terms", 'orderDetail.payerTerms.payer': "payer's terms" } },
    );
  }

  it('shows the payer and its terms in the billing card', async () => {
    renderDetail({ ...ORDER, payer: { organizationId: PAYER_ID, name: 'Payer SA', taxId: 'PL1234567890', terms: 'buyer' } });
    await waitFor(() => expect(screen.getByText('Payer:')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Payer SA' }).getAttribute('href')).toBe(`/organizations/${PAYER_ID}`);
    expect(screen.getByText("buyer's terms")).toBeInTheDocument();
  });

  it('shows no payer line for an order its buyer pays', async () => {
    renderDetail({ ...ORDER, payer: null });
    await waitFor(() => expect(screen.getByText('Payer SA')).toBeInTheDocument());
    expect(screen.queryByText('Payer:')).toBeNull();
  });
});

describe('orders list — payer filter (FR-073)', () => {
  it('sends payerOrganizationId to the server', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/orders/statuses')) return Promise.resolve({ data: { statuses: [] } });
      if (path.startsWith('/api/v1/admin/orders/list-views')) return Promise.resolve({ data: [] });
      if (path.startsWith('/api/v1/admin/orders/custom-field-filters')) return Promise.resolve({ data: [] });
      if (path.startsWith('/api/v1/admin/orders')) {
        return Promise.resolve({ data: [], pagination: { page: 1, pageSize: 20, total: 0 }, counts: {}, paymentStatusCounts: {} });
      }
      return Promise.resolve({ data: [] });
    });
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <OrdersList />
        </MemoryRouter>,
        // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
        { session: adminSession({ permissions: ['*'] }) },
      ),
      { core: { 'common.listToolbar.moreFilters': 'More filters' }, orders: { 'list.filter.payer': 'Payer' } },
    );
    await userEvent.click(await screen.findByRole('button', { name: /^More filters/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Payer' }));
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([path]) => typeof path === 'string' && path.startsWith('/api/v1/admin/orders?') && path.includes(`payerOrganizationId=${PAYER_ID}`),
        ),
      ).toBe(true),
    );
  });
});
