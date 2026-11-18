import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1496 (UX audit SALES-06, on DS-14 #1447) — the order screen used to
 * set one `loading` flag on every read and return a bare "Loading…" while it
 * was set, so each status change, payment change and custom-field save
 * unmounted the page and lost its tab, scroll position and focus. The first
 * load is now a skeleton; a re-read keeps the page and marks it `aria-busy`;
 * and a first load that fails says so, with a retry, instead of "not found".
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
  businessId: 'ORD-0001',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'on_hold',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'gateway' },
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

const BUNDLE = passthroughBundle('core', [
  'common.state.loading',
  'common.action.retry',
  'orderDetail.errors.load',
  'orderDetail.notFound',
  'orderDetail.fields.paymentStatus',
  'orderDetail.paymentStatus.awaiting_payment',
  'orderDetail.paymentStatus.paid',
  'orderDetail.statusChange.paymentTitle',
  'common.statusChange.change',
  'common.statusChange.continue',
  'common.statusChange.confirm',
]);

type OrderRead = () => Promise<unknown>;

function renderDetail(readOrder: OrderRead): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return readOrder();
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }], transitions: [] },
      });
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
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['orders', 'payments'] }) },
    ),
    BUNDLE,
  );
}

const changeButton = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: 'common.statusChange.change orderDetail.fields.paymentStatus' });

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockResolvedValue({ data: ORDER });
});

describe('OrderDetail — first load and refresh (SALES-06)', () => {
  it('shows a busy skeleton region on the first load, not a bare sentence', async () => {
    let release!: () => void;
    renderDetail(() => new Promise((resolve) => (release = () => resolve({ data: ORDER }))));

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('common.state.loading');

    release();
    expect(await changeButton()).toBeInTheDocument();
    expect(document.querySelector('[data-slot="detail-skeleton"]')).toBeNull();
  });

  it('keeps the page mounted and busy while it re-reads after a payment change', async () => {
    const reads: Array<(value: unknown) => void> = [];
    renderDetail(() => new Promise((resolve) => reads.push(resolve)));
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ data: ORDER });

    const button = await changeButton();
    const card = button.closest('[class*="overflow-hidden"]') as HTMLElement;
    expect(card).not.toHaveAttribute('aria-busy');

    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'orderDetail.statusChange.paymentTitle' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'orderDetail.paymentStatus.paid' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));

    await waitFor(() => expect(reads).toHaveLength(2));
    // The re-read is in flight: the same card is still on the page, marked busy,
    // and no skeleton replaced it.
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('[data-slot="detail-skeleton"]')).toBeNull();

    reads[1]!({ data: { ...ORDER, paymentStatus: 'paid' } });
    await waitFor(() => expect(card).not.toHaveAttribute('aria-busy'));
    expect(card).toBeInTheDocument();
  });

  it('a first load that fails is an error with a retry, not "order not found"', async () => {
    let attempt = 0;
    renderDetail(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('network down')) : Promise.resolve({ data: ORDER });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('orderDetail.errors.load');
    expect(screen.queryByText('orderDetail.notFound')).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: 'common.action.retry' }));
    expect(await changeButton()).toBeInTheDocument();
  });
});
