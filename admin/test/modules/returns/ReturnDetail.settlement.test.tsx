import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #150 — the settlement screen makes the corrective invoice legible.
 *
 * The backend has answered three distinguishable outcomes since MR !569:
 * `{issued: true, invoiceId, number}`, `{issued: false, reason:
 * 'order_not_invoiced'}`, or nothing at all when no correction was asked for.
 * The screen showed none of them, which made the deliberate "a never-invoiced
 * order produces no document" ruling indistinguishable from a failure to issue
 * one — the confusion the explicit `reason` field exists to prevent.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>('@/lib/api-client');
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

const { ReturnDetail } = await import('../../../src/modules/returns/ReturnDetail');

const CASE = {
  id: 'r1',
  rmaNumber: 'RMA-1',
  kind: 'return',
  orderId: '00000000-0000-4000-8000-0000000000o1'.replace('o', '0'),
  statusCode: 'received',
  statusLabel: 'Received',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-08-01T10:00:00Z',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  returnDeliveryMethodId: null,
  appliedReturnCost: 0,
  returnCostBearer: 'customer',
  freeReturnEligible: false,
  resolutionType: null,
  rejectionReason: null,
  items: [
    {
      id: 'it1',
      orderItemId: '00000000-0000-4000-8000-000000000004',
      productId: '00000000-0000-4000-8000-000000000005',
      productName: 'Widget',
      quantity: 1,
      reasonId: '00000000-0000-4000-8000-000000000006',
      description: null,
      defaultRefundAmount: 50,
      approvedRefundAmount: 50,
    },
  ],
  comments: [],
};

const PREFILL = {
  currency: 'PLN',
  resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
  items: [
    {
      returnCaseItemId: 'it1',
      productName: 'Widget',
      quantity: 1,
      defaultRefundAmount: 50,
      approvedRefundAmount: 50,
    },
  ],
};

const BUNDLE = passthroughBundle('core', [
  'returns.detail.settlement.title',
  'returns.detail.settlement.createCorrectiveInvoice',
  'returns.detail.settlement.settle',
  'returns.detail.correctiveInvoice.title',
  'returns.detail.correctiveInvoice.issued',
  'returns.detail.correctiveInvoice.open',
  'returns.detail.correctiveInvoice.notDue.order_not_invoiced',
  'returns.detail.correctiveInvoice.notRequested',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: CASE });
    if (path === '/api/v1/admin/returns/statuses') {
      return Promise.resolve({ data: { statuses: [], transitions: [] } });
    }
    if (path === '/api/v1/admin/returns/r1/settlement') return Promise.resolve({ data: PREFILL });
    return Promise.resolve({ data: [] });
  });
});

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

async function settle(): Promise<void> {
  renderDetail();
  await waitFor(() =>
    expect(screen.getByText('returns.detail.settlement.settle')).toBeInTheDocument(),
  );
  await userEvent.click(screen.getByText('returns.detail.settlement.settle'));
}

describe('ReturnDetail — the corrective invoice is legible after settling', () => {
  it('shows the number and links to the corrective invoice that was issued', async () => {
    postSpy.mockResolvedValue({
      data: {
        totalRefundAmount: 50,
        correctiveInvoiceId: 'inv-1',
        correctiveInvoice: { issued: true, invoiceId: 'inv-1', number: 'KOR 3/2026' },
      },
    });

    await settle();

    await waitFor(() => expect(screen.getByText('KOR 3/2026')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /KOR 3\/2026/ })).toHaveAttribute(
      'href',
      '/invoices/inv-1',
    );
  });

  it('says a never-invoiced order was not due a correction, rather than staying silent', async () => {
    postSpy.mockResolvedValue({
      data: {
        totalRefundAmount: 50,
        correctiveInvoiceId: null,
        correctiveInvoice: { issued: false, reason: 'order_not_invoiced' },
      },
    });

    await settle();

    await waitFor(() =>
      expect(
        screen.getByText('returns.detail.correctiveInvoice.notDue.order_not_invoiced'),
      ).toBeInTheDocument(),
    );
    // A deliberate "no document" must not read as one that failed to issue.
    expect(screen.queryByText('returns.detail.correctiveInvoice.issued')).not.toBeInTheDocument();
  });

  it('says so when the operator did not ask for a correction', async () => {
    postSpy.mockResolvedValue({ data: { totalRefundAmount: 50 } });

    renderDetail();
    await waitFor(() =>
      expect(
        screen.getByLabelText('returns.detail.settlement.createCorrectiveInvoice'),
      ).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByLabelText('returns.detail.settlement.createCorrectiveInvoice'),
    );
    await userEvent.click(screen.getByText('returns.detail.settlement.settle'));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/returns/r1/settlement',
        expect.objectContaining({ createCorrectiveInvoice: false }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText('returns.detail.correctiveInvoice.notRequested'),
      ).toBeInTheDocument(),
    );
  });
});
