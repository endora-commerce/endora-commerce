import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 085 (FR-024) — the payment-status control offers exactly the values
 * the platform accepts, and shows the one it does not. Since issue #1470
 * (DS-18) the control is a badge and a "Change…" dialog, not a select that
 * writes on `change`; payment status stays operator-editable with the
 * `payments` module present (owner decision DEC-11 — bank transfers).
 *
 * Two defects meet on this control. `POST /api/v1/admin/orders/:id/payment-status`
 * has only ever accepted `paid` and `refunded`, while the select offered a
 * hand-written four — so `awaiting_payment` and `deferred` were offered and
 * refused, and an operator who picked one got an error for choosing an option
 * the screen had shown them. And feature 085 makes `failed` reachable, which is
 * a value an operator must be able to *read* on an order and must never be able
 * to *set*: a payment fails at the gateway or it does not.
 *
 * So the two lists are now different things. What is settable is derived from
 * the contract the route parses, so it cannot drift from it again; what is
 * displayed is the order's own value, as a badge, whether or not it is
 * settable — and it is never offered as a target.
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

const orderWith = (paymentStatus: string): Record<string, unknown> => ({
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'on_hold',
  paymentStatus,
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
  'orderDetail.fields.paymentStatus',
  'orderDetail.paymentStatus.awaiting_payment',
  'orderDetail.paymentStatus.paid',
  'orderDetail.paymentStatus.failed',
  'orderDetail.paymentStatus.deferred',
  'orderDetail.paymentStatus.refunded',
  'orderDetail.statusChange.paymentTitle',
  'orderDetail.statusChange.noPermission',
  'common.statusChange.change',
  'common.statusChange.continue',
  'common.statusChange.confirm',
]);

function renderDetail(paymentStatus: string, permissions: string[] = ['*']): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: orderWith(paymentStatus) });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: {
          statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }],
          transitions: [],
        },
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
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['orders', 'payments'] }) },
    ),
    BUNDLE,
  );
}

/**
 * `findByRole` is the wait, and there is deliberately no `waitFor` around it.
 * Nesting one async utility inside another does not compose their budgets: the
 * outer loop skips every tick while its callback's promise is still pending, so
 * the outer wrapper gets exactly one attempt inside a deadline it shares with
 * the inner one.
 */
async function changeButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'common.statusChange.change orderDetail.fields.paymentStatus' });
}

/** Opens the dialog and answers the values it offers. */
async function offered(): Promise<string[]> {
  await userEvent.click(await changeButton());
  const dialog = await screen.findByRole('dialog', { name: 'orderDetail.statusChange.paymentTitle' });
  return within(dialog)
    .getAllByRole('radio')
    .map((radio) => (radio as HTMLInputElement).value)
    .sort();
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockResolvedValue({ data: orderWith('paid') });
});

describe('OrderDetail — the payment-status control (085 FR-024, #1470)', () => {
  it('renders no select that could write on change', async () => {
    renderDetail('awaiting_payment');
    await changeButton();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers only the values the route accepts, minus the current one', async () => {
    renderDetail('paid');
    expect(await offered()).toEqual(['refunded']);
  });

  /**
   * The value the settlement ingress writes and no operator may. It has to be
   * on the screen — an operator reading an order needs to see that its payment
   * failed — and it must never be offered, because a payment does not become
   * failed by somebody saying so.
   */
  it('shows a failed payment without offering it as something to set', async () => {
    renderDetail('failed');
    expect(await screen.findByText('orderDetail.paymentStatus.failed')).toBeInTheDocument();
    expect(await offered()).toEqual(['paid', 'refunded']);
  });

  /**
   * The pre-existing half of the same defect: `awaiting_payment` and `deferred`
   * were offered and refused by the server. They are still shown when the order
   * is in one of them, and never offered.
   */
  it('shows an unsettable current value rather than dropping it', async () => {
    for (const current of ['awaiting_payment', 'deferred']) {
      renderDetail(current);
      expect(await screen.findByText(`orderDetail.paymentStatus.${current}`)).toBeInTheDocument();
      expect(await offered()).toEqual(['paid', 'refunded']);
      cleanup();
    }
  });

  it('writes only after the confirm step (DEC-11: a bank transfer marked paid by hand)', async () => {
    renderDetail('awaiting_payment');
    await userEvent.click(await changeButton());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'orderDetail.paymentStatus.paid' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    expect(postSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/payment-status', { to: 'paid' }),
    );
  });

  it('disables the change and says why without orders:write', async () => {
    renderDetail('awaiting_payment', ['orders:read']);
    const button = await changeButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('orderDetail.statusChange.noPermission');
  });
});
