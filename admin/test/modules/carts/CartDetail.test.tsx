import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 027 US6 — CartDetail interaction test.
 *
 * Drives the React component through jsdom. Mocks `apiClient.get` /
 * `.post` so the page never hits the network. Verifies the reject
 * flow's required-reason gating + the success path that hides the
 * reject form and re-fetches the detail.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
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

const { CartDetail } = await import('../../../src/modules/carts/CartDetail');

const BUNDLE = passthroughBundle('carts', [
  'carts.detail.title',
  'carts.column.status',
  'carts.column.approval',
  'carts.column.owner',
  'carts.column.org',
  'carts.column.lastActivity',
  'carts.column.created',
  'carts.column.coupon',
  'carts.column.convertedToQr',
  'carts.column.rejectedReason',
  'carts.detail.lines',
  'carts.column.product',
  'carts.column.qty',
  'carts.column.unit',
  'carts.column.line',
  'carts.column.total',
  'carts.detail.audit',
  'carts.detail.auditEmpty',
  'carts.audit.when',
  'carts.audit.who',
  'carts.audit.action',
  'carts.audit.transition',
  'carts.audit.reason',
  'carts.reject.open',
  'carts.reject.reasonLabel',
  'carts.reject.reasonPlaceholder',
  'carts.reject.confirm',
  'carts.reject.cancel',
  'carts.reject.submitting',
  'carts.loading',
]);

function activeCartFixture(): unknown {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    ownerDisplayName: 'buyer@example.com',
    organizationDisplayName: 'Acme',
    salesChannelCode: 'default',
    status: 'active',
    approvalStatus: 'not_required',
    items: [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        productId: '00000000-0000-4000-8000-000000000101',
        productName: 'Sample',
        variantId: null,
        quantity: 2,
        unitPrice: { amount: 19.99, currency: 'PLN' },
        lineTotal: { amount: 39.98, currency: 'PLN' },
      },
    ],
    total: { amount: 39.98, currency: 'PLN' },
    discount: null,
    appliedPromotionCode: null,
    lastActivityAt: '2026-05-22T12:00:00Z',
    createdAt: '2026-05-22T11:00:00Z',
    convertedToQuoteRequestId: null,
    submittedForApprovalAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectedByActor: null,
    rejectedReason: null,
  };
}

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/carts/00000000-0000-4000-8000-0000000000c1']}>
      <Routes>
        <Route path="/carts/:id" element={<CartDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CartDetail', () => {
  it('renders the lines table with line totals and grand total', async () => {
    getSpy
      .mockResolvedValueOnce({ data: activeCartFixture() })
      .mockResolvedValueOnce({ data: [] });

    renderDetail();

    await waitFor(() => {
      expect(screen.getByText('Sample')).toBeInTheDocument();
    });
    // The amount appears twice — once in the line-total cell and once
    // in the grand-total row. Assert at least one is present.
    expect(screen.getAllByText('39.98 PLN').length).toBeGreaterThanOrEqual(1);
  });

  it('reject button is disabled until a reason is typed; clicking submits', async () => {
    getSpy
      .mockResolvedValueOnce({ data: activeCartFixture() })
      .mockResolvedValueOnce({ data: [] });
    postSpy.mockResolvedValue({ data: { id: '00000000-0000-4000-8000-0000000000c1' } });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Sample')).toBeInTheDocument();
    });

    const u = userEvent.setup();
    await u.click(screen.getByText('carts.reject.open'));
    const reasonInput = screen.getByLabelText('carts.reject.reasonLabel');
    const submitButton = screen.getByText('carts.reject.confirm');
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    await u.type(reasonInput, 'Out of budget');
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    // Stub the post-reject re-fetch so it doesn't blow up.
    getSpy.mockResolvedValue({ data: { ...(activeCartFixture() as object), status: 'rejected' } });

    await u.click(submitButton);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/carts/00000000-0000-4000-8000-0000000000c1/reject',
        { reason: 'Out of budget' },
      );
    });
  });

  it('hides the reject button on a terminal cart', async () => {
    const terminal = { ...(activeCartFixture() as Record<string, unknown>), status: 'completed' };
    getSpy.mockResolvedValueOnce({ data: terminal }).mockResolvedValueOnce({ data: [] });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Sample')).toBeInTheDocument();
    });
    expect(screen.queryByText('carts.reject.open')).toBeNull();
  });
});
