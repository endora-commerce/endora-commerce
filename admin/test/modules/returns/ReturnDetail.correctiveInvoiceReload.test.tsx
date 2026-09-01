import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #156 / D-92 — the corrective-invoice outcome survives a reload.
 *
 * MR !579 made the three outcomes legible *at the moment of settling*, and said
 * so in its own comment: "the case detail does not carry it — the refund row
 * persists the invoice id but not the reason — so nothing here can read it back
 * after a reload." The `Refund` row now persists the three-way answer and the
 * case-detail endpoint returns it, so the card renders for a case somebody else
 * settled yesterday.
 *
 * Every case below renders a **resolved** case with no settlement performed in
 * this session: `settlement` state is null, the settlement form is not even
 * mounted, and the only source of the answer is the reloaded detail.
 */

const getSpy = vi.fn();

// The screen is `@endora-commerce/mod-returns`' since feature 091's batch 8, so it
// takes `apiClient` from the kit rather than from the admin's re-export shim.
// The shim forwards the kit's own binding, so mocking it would replace a module
// this screen never imports — reference equality across that seam is what
// `admin/test/kit/admin-kit-shims.test.ts` asserts, and it is what makes the
// distinction matter here.
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

const { ReturnDetail } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDetail'
);

const RESOLVED_CASE = {
  id: 'r1',
  rmaNumber: 'RMA-1',
  kind: 'return',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'resolved',
  statusLabel: 'Resolved',
  totalRefundAmount: 50,
  currency: 'PLN',
  submittedAt: '2026-08-01T10:00:00Z',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  returnDeliveryMethodId: null,
  appliedReturnCost: 0,
  returnCostBearer: 'customer',
  freeReturnEligible: false,
  resolutionType: 'refund',
  rejectionReason: null,
  items: [],
  comments: [],
  correctiveInvoice: null as { outcome: string; invoiceId: string | null } | null,
};

const BUNDLE = passthroughBundle('core', [
  'returns.detail.correctiveInvoice.title',
  'returns.detail.correctiveInvoice.issued',
  'returns.detail.correctiveInvoice.open',
  'returns.detail.correctiveInvoice.notDue.order_not_invoiced',
  'returns.detail.correctiveInvoice.notRequested',
]);

function renderResolved(
  correctiveInvoice: { outcome: string; invoiceId: string | null } | null,
): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') {
      return Promise.resolve({ data: { ...RESOLVED_CASE, correctiveInvoice } });
    }
    if (path === '/api/v1/admin/returns/statuses') {
      return Promise.resolve({ data: { statuses: [], transitions: [] } });
    }
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('ReturnDetail — the corrective invoice after a reload (D-92)', () => {
  it('links to the correction that was issued', async () => {
    renderResolved({ outcome: 'issued', invoiceId: 'inv-1' });

    await waitFor(() =>
      expect(screen.getByText('returns.detail.correctiveInvoice.issued')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', '/invoices/inv-1');
  });

  it('says a never-invoiced order was not due a correction', async () => {
    renderResolved({ outcome: 'not_due', invoiceId: null });

    await waitFor(() =>
      expect(
        screen.getByText('returns.detail.correctiveInvoice.notDue.order_not_invoiced'),
      ).toBeInTheDocument(),
    );
    // The whole point of #156: a deliberate "no document" must not read as one
    // that failed to appear.
    expect(screen.queryByText('returns.detail.correctiveInvoice.issued')).not.toBeInTheDocument();
  });

  it('says so when no correction was asked for', async () => {
    renderResolved({ outcome: 'not_requested', invoiceId: null });

    await waitFor(() =>
      expect(
        screen.getByText('returns.detail.correctiveInvoice.notRequested'),
      ).toBeInTheDocument(),
    );
  });

  it('renders no card at all for a case that moved no money', async () => {
    renderResolved(null);

    await waitFor(() => expect(screen.getByText('RMA-1')).toBeInTheDocument());
    expect(
      screen.queryByText('returns.detail.correctiveInvoice.title'),
    ).not.toBeInTheDocument();
  });
});
