import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 085 Phase G (FR-021, FR-022) — the money axis on the admin orders
 * list.
 *
 * Two defects meet on this screen. It could not **filter** on payment status at
 * all, which after this feature makes the one order only a platform
 * administrator can rescue unfindable; and it rendered the value **raw**
 * (`render: (o) => o.paymentStatus`), so an operator read `awaiting_payment` in
 * a screen that is otherwise entirely in their language.
 *
 * The labels are the ones the order **detail** screen already uses
 * (`orderDetail.paymentStatus.*`) rather than a second set beside them: Phase C
 * made `failed` displayable there, and one vocabulary that two screens read is
 * what stops the third copy.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});


const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');

/**
 * The shipped copy for the two languages, keyed exactly as the bundles key it.
 * Rendering the same row under each is what tells a translated column from a
 * raw one: in English the code and its label happen to read alike, and in
 * Polish they cannot.
 */
const EN = {
  core: {
    'orders.field.paymentStatus': 'Payment status',
    'orders.filter.toggle': 'Filters',
    'orders.filter.all': 'All',
    'orders.column.payment': 'Payment',
    'orderDetail.paymentStatus.failed': 'failed',
    'orderDetail.paymentStatus.awaiting_payment': 'awaiting payment',
    'orderDetail.paymentStatus.paid': 'paid',
    'orderDetail.paymentStatus.deferred': 'deferred',
    'orderDetail.paymentStatus.refunded': 'refunded',
  },
};
const PL = {
  core: {
    'orders.field.paymentStatus': 'Status płatności',
    'orders.filter.toggle': 'Filtry',
    'orders.filter.all': 'Wszystkie',
    'orders.column.payment': 'Płatność',
    'orderDetail.paymentStatus.failed': 'nieudana',
    'orderDetail.paymentStatus.awaiting_payment': 'oczekuje na płatność',
    'orderDetail.paymentStatus.paid': 'opłacona',
    'orderDetail.paymentStatus.deferred': 'odroczona',
    'orderDetail.paymentStatus.refunded': 'zwrócona',
  },
};

function row(id: string, biz: string, paymentStatus: string) {
  return {
    id,
    businessId: biz,
    customerName: 'Jan Kowalski',
    status: 'on_hold',
    statusName: { en: 'On Hold' },
    paymentStatus,
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Acme',
    total: 99.5,
    currency: 'PLN',
    placedAt: '2026-05-22T12:00:00Z',
  };
}

beforeEach(() => {
  cleanup();
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return Promise.resolve({ data: { statuses: [{ code: 'on_hold', name: { en: 'On Hold' } }] } });
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/orders')) {
      return Promise.resolve({
        data: [row('o1', 'ORD-1', 'failed'), row('o2', 'ORD-2', 'refunded')],
        pagination: { page: 1, pageSize: 20, total: 2 },
        counts: { on_hold: 2 },
        paymentStatusCounts: { failed: 1, refunded: 1 },
      });
    }
    return Promise.resolve({ data: [] });
  });
});

function renderList(bundle: Record<string, Record<string, string>>): void {
  renderWithI18n(
    <MemoryRouter>
      <OrdersList />
    </MemoryRouter>,
    bundle,
  );
}

describe('OrdersList — payment status (feature 085)', () => {
  it('renders the payment status in the operator language, not as a raw code', async () => {
    renderList(EN);
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0);
  });

  it('renders the same row in Polish, which a raw column cannot do', async () => {
    renderList(PL);
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());
    expect(screen.getAllByText('nieudana').length).toBeGreaterThan(0);
    expect(screen.getAllByText('zwrócona').length).toBeGreaterThan(0);
    // The raw code is what the column used to print, in every language.
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
  });

  it('sends the payment-status filter to the server', async () => {
    renderList(EN);
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());

    // The filter lives in the collapsible advanced panel, beside the two method
    // filters it reads like.
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const control = await screen.findByLabelText('Payment status');
    await userEvent.click(control);
    await userEvent.click(await screen.findByText('failed (1)'));

    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([p]) => typeof p === 'string' && p.includes('paymentStatus=failed'),
        ),
      ).toBe(true),
    );
  });

  it('labels each filter option with what selecting it would yield', async () => {
    renderList(EN);
    await waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByLabelText('Payment status'));

    // The count comes from `paymentStatusCounts`, the map the list gained
    // beside `counts` — one map could not carry both axes, because `paid` is an
    // order status code as well as a payment status.
    expect(await screen.findByText('failed (1)')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
  });
});
