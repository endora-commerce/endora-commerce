import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1470 (SALES-04, through DS-18 #1435) — the order status committed the
 * moment a select option was picked, so a stray arrow key moved an order to
 * *Shipped*, with the e-mails, stock and invoices that follow. It is now the
 * current status as a badge and a "Change…" dialog that offers the configured
 * graph's outgoing transitions and writes only after a confirmation step.
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

const orderWith = (status: string): Record<string, unknown> => ({
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status,
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
});

const BUNDLE = passthroughBundle('core', [
  'orderDetail.fields.orderStatus',
  'orderDetail.statusChange.orderTitle',
  'orderDetail.statusChange.orderConsequence',
  'common.statusChange.change',
  'common.statusChange.continue',
  'common.statusChange.confirm',
  'common.statusChange.noTransitions',
]);

const GRAPH = {
  statuses: [
    { code: 'processing', name: { en: 'Processing', pl: 'W realizacji' }, isTerminal: false },
    { code: 'shipped', name: { en: 'Shipped', pl: 'Wysłane' }, isTerminal: false },
    { code: 'cancelled', name: { en: 'Cancelled', pl: 'Anulowane' }, isTerminal: true },
    { code: 'on_hold', name: { en: 'On hold', pl: 'Wstrzymane' }, isTerminal: false },
  ],
  transitions: [
    { fromStatusCode: 'processing', toStatusCode: 'shipped' },
    { fromStatusCode: 'processing', toStatusCode: 'cancelled' },
    { fromStatusCode: 'shipped', toStatusCode: 'cancelled' },
  ],
};

function renderDetail(status: string): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: orderWith(status) });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: GRAPH });
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
    BUNDLE,
  );
}

const changeButton = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: 'common.statusChange.change orderDetail.fields.orderStatus' });

async function openDialog(): Promise<HTMLElement> {
  const button = await changeButton();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return screen.findByRole('dialog', { name: 'orderDetail.statusChange.orderTitle' });
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockResolvedValue({ data: orderWith('shipped') });
});

describe('OrderDetail — the order-status control (#1470)', () => {
  it('offers the graph\'s outgoing transitions only, and writes nothing on pick', async () => {
    renderDetail('processing');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const dialog = await openDialog();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['shipped', 'cancelled']);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Shipped' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('posts the chosen status after the confirm step, through the existing route', async () => {
    renderDetail('processing');
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Shipped' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    expect(within(dialog).getByText(/orderDetail\.statusChange\.orderConsequence/)).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/status', { to: 'shipped' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // Issue #1499 (SALES-17) — the control announces the change itself and its badge shows
  // the new value; the page adds no success banner of its own above the tabs.
  it('adds no success banner above the tabs once the change committed', async () => {
    renderDetail('processing');
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Shipped' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/orderDetail\.messages\.orderMoved/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('keeps the dialog open with the server\'s refusal', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'INVALID_TRANSITION', message: 'Not allowed from here.' } }),
    );
    renderDetail('processing');
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Cancelled' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not allowed from here.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables the change and says why when the status has no outgoing transition', async () => {
    renderDetail('cancelled');
    const button = await changeButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('common.statusChange.noTransitions');
  });
});
