import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/orders/i18n/en.json';
import pl from '../../../../packages/modules/orders/i18n/pl.json';

/**
 * `specs/142-order-transition-atomicity/` — User Story 4, FR-019.
 *
 * A release the platform is still retrying, or that is waiting for a
 * switched-off module, used to be invisible: the order read `cancelled` and
 * nothing said its stock or its credit was still held. The order page now says
 * which release is outstanding and what it is waiting for.
 *
 * The strings are asserted from the module's **own shipped bundles**, in both
 * languages, rather than from passthrough keys: the point of the notice is the
 * sentence an operator reads, and a key rendered raw would pass a key-shaped
 * assertion.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

/**
 * `OrderDetail` resolves the payments tab's visibility through
 * `useSurfaceVisibility`, which reads the auth and module-presence contexts.
 * This file is about neither, so both are stubbed permissive; the gate itself is
 * covered in `OrderDetail.payments-tab-gating.test.tsx`.
 */


// **Re-keyed by feature 091's Phase 4 batch 15, and this is the trap batch 14
// found by sweeping rather than by running.** The mock named the admin's own
// path while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which the old
// path is only a re-export shim — so the old spelling intercepts nothing and
// vitest reports that by making the mock **inert** rather than by failing.
// `tsc` cannot see it: both specifiers compile.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
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


function serveOrder(pendingEffects?: unknown): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') {
      return Promise.resolve({
        data: { ...ORDER, status: 'cancelled', ...(pendingEffects ? { pendingEffects } : {}) },
      });
    }
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: {
          statuses: [{ code: 'cancelled', name: { en: 'Cancelled' }, isTerminal: true }],
          transitions: [],
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(bundle: Record<string, string>): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments'] }),
      },
    ),
    { core: {}, orders: bundle },
  );
}

const WAITING = [
  { effect: 'stock.release', blockedOn: 'inventory', attempts: 0, lastAttemptAt: null },
];

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('OrderDetail — outstanding follow-ups (spec 142, US4)', () => {
  it('names the release and the module it is waiting for', async () => {
    serveOrder(WAITING);

    renderDetail(en);

    const notice = await screen.findByTestId('order-pending-effects');
    expect(notice).toHaveTextContent(en['pendingEffects.title']);
    expect(notice).toHaveTextContent('Stock release');
    expect(notice).toHaveTextContent('waiting for the Inventory module to be switched on');
  });

  it('says the same in Polish', async () => {
    serveOrder(WAITING);

    renderDetail(pl);

    const notice = await screen.findByTestId('order-pending-effects');
    expect(notice).toHaveTextContent(pl['pendingEffects.title']);
    expect(notice).toHaveTextContent('Zwolnienie stanu magazynowego');
    expect(notice).toHaveTextContent('oczekuje na włączenie modułu Magazyn');
  });

  it('reports a release that keeps failing with its attempt count', async () => {
    serveOrder([
      {
        effect: 'credit.release',
        blockedOn: null,
        attempts: 5,
        lastAttemptAt: '2026-10-03T10:05:00.000Z',
      },
    ]);

    renderDetail(en);

    const notice = await screen.findByTestId('order-pending-effects');
    expect(notice).toHaveTextContent('Credit limit release');
    expect(notice).toHaveTextContent('failed attempts so far: 5');
    expect(notice).toHaveTextContent(en['pendingEffects.needsAttention']);
  });

  it('names a module it has no label for by its id rather than dropping it', async () => {
    serveOrder([
      { effect: 'stock.release', blockedOn: 'warehouse_x', attempts: 0, lastAttemptAt: null },
    ]);

    renderDetail(en);

    expect(await screen.findByTestId('order-pending-effects')).toHaveTextContent('warehouse_x');
  });

  it('renders no notice for an order that owes nothing', async () => {
    serveOrder();

    renderDetail(en);

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1'));
    await screen.findAllByText(/./);
    expect(screen.queryByTestId('order-pending-effects')).not.toBeInTheDocument();
  });
});
