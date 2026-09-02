import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #149 — "issue and send" says whether the e-mail went out.
 *
 * The route answers `{ data, email }` now, where `email` distinguishes a
 * delivery from a suppression across seven named reasons. A screen that keeps
 * reporting "Invoice issued." for all three shapes is the same defect one layer
 * up: the operator acts, the platform knows, and the surface hides it.
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

const BUNDLE = passthroughBundle('core', [
  'orderDetail.issueInvoice.action',
  'orderDetail.issueInvoice.done',
  'orderDetail.issueInvoice.doneEmailSent',
  'orderDetail.issueInvoice.doneEmailNotSent',
  'invoices.emailNotSent.deactivated',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    return Promise.resolve({ data: [] });
  });
});

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

async function clickIssue(): Promise<void> {
  renderDetail();
  await waitFor(() => expect(screen.getByText('orderDetail.issueInvoice.action')).toBeInTheDocument());
  await userEvent.click(screen.getByText('orderDetail.issueInvoice.action'));
}

describe('OrderDetail — issue invoice reports the send-on-issue outcome', () => {
  it('confirms the e-mail when it was sent', async () => {
    postSpy.mockResolvedValue({ data: { id: 'i1' }, email: { status: 'sent' } });

    await clickIssue();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.issueInvoice.doneEmailSent')).toBeInTheDocument(),
    );
  });

  it('names the reason a suppressed e-mail did not go out', async () => {
    postSpy.mockResolvedValue({
      data: { id: 'i1' },
      email: { status: 'not_sent', reason: 'deactivated' },
    });

    await clickIssue();

    // The issuance stands; only the notification did not happen, and the
    // operator is told which of the seven reasons applied.
    await waitFor(() =>
      expect(screen.getByText(/orderDetail.issueInvoice.doneEmailNotSent/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('orderDetail.issueInvoice.doneEmailSent')).not.toBeInTheDocument();
  });

  it('says only "issued" when the operator switched send-on-issue off', async () => {
    postSpy.mockResolvedValue({ data: { id: 'i1' }, email: { status: 'not_requested' } });

    await clickIssue();

    await waitFor(() =>
      expect(screen.getByText('orderDetail.issueInvoice.done')).toBeInTheDocument(),
    );
  });
});
