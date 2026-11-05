import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #767 — the Organization panel of the admin quote-request detail. A
 * personal (B2C) Organization's tax id is an internal placeholder, so the API
 * answers `taxId: null` and `isPersonal: true` for it and the panel prints
 * "Individual customer" where the tax-id line was; a company
 * Organization's tax id is shown as before.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000p1';

const BUNDLE = passthroughBundle('core', ['rfq.detail.sections.organization', 'rfq.detail.org.taxId', 'rfq.detail.org.individualCustomer']);

function rfqPayload(organization: Record<string, unknown>): Record<string, unknown> {
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    organization,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: true,
    currentRevisionNumber: 2,
    headerNote: 'Bulk order',
    cancellationReason: null,
    customFieldValues: {},
    items: [
      {
        id: '00000000-0000-4000-8000-0000000000i1',
        productId: PRODUCT_ID,
        productName: 'Widget',
        productSlug: 'widget',
        variantLabel: null,
        quantity: 5,
        desiredUnitPrice: 9.5,
        agreedUnitPrice: 9,
        lineNote: null,
        lineCurrency: 'PLN',
        discountPercent: null,
      },
    ],
    events: [],
    submittedAt: '2026-08-01T10:00:00.000Z',
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: null,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    version: 7,
  };
}

function renderDetail(organization: Record<string, unknown>): void {
  getSpy.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/quote-requests/')) {
      return Promise.resolve({ data: rfqPayload(organization) });
    }
    return Promise.resolve({ data: { resolvedPrice: { basePrice: null, salePrice: null } } });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
        <Routes>
          <Route path="/quote-requests/:id" element={<RfqDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['rfqs:handle'] }),
        presence: modulePresence({ present: ['quote_requests'] }),
        contributions: [],
      },
    ),
    BUNDLE,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail — Organization panel tax id (#767)', () => {
  it("shows a company Organization's tax id", async () => {
    renderDetail({ id: '00000000-0000-4000-8000-0000000000a1', name: 'Acme', legalName: null, taxId: '5260250274', isPersonal: false, vatStatus: 'vat_payer' });
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('5260250274')).toBeInTheDocument();
    expect(screen.getByText(/rfq\.detail\.org\.taxId/)).toBeInTheDocument();
    expect(screen.queryByText('rfq.detail.org.individualCustomer')).not.toBeInTheDocument();
  });

  it('labels a personal Organization "Individual customer" where the tax-id line was', async () => {
    renderDetail({ id: '00000000-0000-4000-8000-0000000000a1', name: 'Jan Kowalski', legalName: null, taxId: null, isPersonal: true, vatStatus: 'vat_exempt' });
    expect(await screen.findByText('Jan Kowalski')).toBeInTheDocument();
    expect(screen.queryByText(/rfq\.detail\.org\.taxId/)).not.toBeInTheDocument();
    // Owner ruling of 2026-11-05: the line says what the Organization is instead.
    expect(screen.getByText('rfq.detail.org.individualCustomer')).toBeInTheDocument();
  });
});
