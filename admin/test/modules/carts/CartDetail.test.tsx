import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 027 US6 — CartDetail interaction test.
 *
 * Drives the React component through jsdom. Mocks `apiClient.get` /
 * `.post` so the page never hits the network. The reject flow itself —
 * the header menu entry and its dialog (issue #1548) — is
 * `CartDetail.reject-dialog.test.tsx`.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

// The kit's `lib` barrel, not `@/lib/api-client`: the screen is a package's now
// and resolves `apiClient` through `@endora-commerce/admin-kit/lib`, which is
// the same module specifier the admin application resolves, so one mock covers
// both. Keyed on the specifier the component actually imports — `vi.mock` keys
// on a resolved module id, and the old key would have silently mocked nothing.
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

/**
 * The screen lives in `packages/modules/carts/src/admin/` since feature 091's
 * Phase 4 batch four, so it takes `apiClient` from the published kit and is
 * reached here through the **route factory the module declares** — the same
 * entry point `admin/src/App.tsx` uses. Importing the package's source instead
 * would evaluate a second copy of it beside its `dist`; going through
 * `contributions.routes` also makes this test fail if the declaration ever
 * stops naming the screen, which is the coupling the move creates.
 */
const { contributions } = await import('@endora-commerce/mod-carts/admin');
const CartDetail = (await contributions.routes![1]!.component())
  .default as () => ReactNode;

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
  'carts.column.discount',
  'carts.detail.netTotal',
  'carts.detail.grossTotal',
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

function renderDetailWithHandle(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/carts/00000000-0000-4000-8000-0000000000c1']}>
      <Routes>
        <Route path="/carts/:id" element={<CartDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
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
    // in the grand-total row. Assert at least one is present. PLN renders in
    // its pl-PL currency style ("39,98 zł") with a non-breaking space before
    // the symbol, so match tolerantly.
    expect(screen.getAllByText(/39,98\s*zł/).length).toBeGreaterThanOrEqual(1);
  });

  /** Issue #1396 — the net total row, and the gross total row when the detail knows it. */
  it('shows the net total and the gross total, and omits the gross row when it is unknown', async () => {
    getSpy
      .mockResolvedValueOnce({ data: { ...(activeCartFixture() as object), totalGross: { amount: 49.18, currency: 'PLN' } } })
      .mockResolvedValueOnce({ data: [] });
    const { unmount } = renderDetailWithHandle();
    await waitFor(() => {
      expect(screen.getByText('carts.detail.grossTotal')).toBeInTheDocument();
    });
    expect(screen.getByText('carts.detail.netTotal')).toBeInTheDocument();
    expect(screen.getByText(/49,18\s*zł/)).toBeInTheDocument();
    unmount();

    getSpy
      .mockResolvedValueOnce({ data: { ...(activeCartFixture() as object), totalGross: null } })
      .mockResolvedValueOnce({ data: [] });
    renderDetailWithHandle();
    await waitFor(() => {
      expect(screen.getByText('carts.detail.netTotal')).toBeInTheDocument();
    });
    expect(screen.queryByText('carts.detail.grossTotal')).toBeNull();
  });

  it('hides the reject button on a terminal cart', async () => {
    const terminal = { ...(activeCartFixture() as Record<string, unknown>), status: 'completed' };
    getSpy.mockResolvedValueOnce({ data: terminal }).mockResolvedValueOnce({ data: [] });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('Sample')).toBeInTheDocument();
    });
    expect(screen.queryByText('carts.reject.open')).toBeNull();
    // Issue #1548 — the only entry of the header's "More" menu is off, so there is no menu.
    expect(screen.queryByRole('button', { name: 'common.action.more' })).toBeNull();
  });
});
