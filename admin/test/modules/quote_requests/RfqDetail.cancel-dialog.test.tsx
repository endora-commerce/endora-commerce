/**
 * Issue #1474 (SALES-09) — cancelling a quote request asks in the kit's
 * `ModalDialog`: named by its title, the reason field labelled and focused,
 * Tab held inside, Escape and *Keep RFQ* returning focus to *Cancel RFQ*, the
 * scrim inert so a stray click does not drop a typed reason, and a refused
 * cancellation announced inside the dialog rather than behind its scrim.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

const getSpy = vi.fn();
const patchSpy = vi.fn();
const postSpy = vi.fn();

// The **kit's** barrel, not `@/lib/api-client`. The screen is
// `@endora-commerce/mod-quote-requests/admin`'s since feature 091's batch 12
// and resolves `apiClient` there; the admin's own path is a re-export shim of
// the same binding, so mocking the shim left the real client mounted and every
// case below timed out waiting for a fetch that had gone to the network layer.
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

// The Modify tab's product select and the overview's custom-field panel both
// pull their own data chains; neither is under test here. Both are the kit's —
// `CustomFieldValuesPanel` since P4e (a published component, not
// `custom_fields`' fragment: `admin-component-contribution.md` §9.1) and
// `ProductPicker` since P2 — so one mock over the kit's `components` barrel
// covers the pair. It used to be two, the second naming
// `@/modules/catalog/components/ProductPicker`, which the screen has not
// imported since P2 and which therefore stubbed nothing.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

installOffsetParentShim();

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000p1';

const FULL_BUNDLE = passthroughBundle('core', [
  'rfq.detail.cancelRfq',
  'rfq.detail.cancelDialog.title',
  'rfq.detail.cancelDialog.confirm',
  'rfq.detail.cancelDialog.dismiss',
  'rfq.detail.cancelReason',
  'rfq.detail.cancelReasonPlaceholder',
  'rfq.detail.error.cancel',
  'rfq.detail.info.canceled',
  'rfq.detail.tabs.overview',
]);

interface RfqOverrides {
  status?: string;
  expiresAt?: string | null;
  awaitingCustomerRevisionAcceptance?: boolean;
}

function rfqPayload(overrides: RfqOverrides = {}): Record<string, unknown> {
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    organization: null,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    status: overrides.status ?? 'Pending',
    awaitingCustomerRevisionAcceptance: overrides.awaitingCustomerRevisionAcceptance ?? true,
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
    expiresAt: overrides.expiresAt === undefined ? null : overrides.expiresAt,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    version: 7,
  };
}

function renderDetail(overrides: RfqOverrides = {}): void {
  getSpy.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/quote-requests/')) {
      return Promise.resolve({ data: rfqPayload(overrides) });
    }
    return Promise.resolve({ data: { resolvedPrice: { basePrice: null, salePrice: null } } });
  });
  renderWithI18n(
    // The screen ends with a zone other modules may contribute to, so it is
    // rendered under the session providers; nobody contributes here.
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
    FULL_BUNDLE,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  postSpy.mockReset();
  vi.restoreAllMocks();
});

async function openCancel(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderDetail({ status: 'Pending' });
  await user.click(await screen.findByRole('button', { name: /rfq\.detail\.cancelRfq/ }));
  return user;
}

describe('RfqDetail — the cancel dialog (#1474)', () => {
  it('is a modal dialog named by its title, with the reason labelled and focused', async () => {
    await openCancel();
    const dialog = screen.getByRole('dialog', { name: 'rfq.detail.cancelDialog.title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('rfq.detail.cancelReason')).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = await openCancel();
    const reason = screen.getByLabelText('rfq.detail.cancelReason');
    await user.tab();
    expect(screen.getByRole('button', { name: 'rfq.detail.cancelDialog.dismiss' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /rfq\.detail\.cancelDialog\.confirm/ })).toHaveFocus();
    await user.tab();
    expect(reason).toHaveFocus();
  });

  it('closes on Escape and returns focus to Cancel RFQ', async () => {
    const user = await openCancel();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /rfq\.detail\.cancelRfq/ })).toHaveFocus();
  });

  it('does not drop a typed reason on a click on the scrim', async () => {
    const user = await openCancel();
    await user.type(screen.getByLabelText('rfq.detail.cancelReason'), 'Out of stock');
    const scrim = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.pointer({ keys: '[MouseLeft]', target: scrim });
    expect(screen.getByLabelText('rfq.detail.cancelReason')).toHaveValue('Out of stock');
  });

  it('sends the reason and closes on confirm', async () => {
    postSpy.mockResolvedValue({ data: {} });
    const user = await openCancel();
    await user.type(screen.getByLabelText('rfq.detail.cancelReason'), 'Out of stock');
    await user.click(screen.getByRole('button', { name: /rfq\.detail\.cancelDialog\.confirm/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postSpy).toHaveBeenCalledWith(
      `/api/v1/admin/quote-requests/${RFQ_ID}/cancel`,
      { reason: 'Out of stock' },
      { headers: { 'If-Match': '"7"' } },
    );
  });

  it('announces a refused cancellation inside the dialog and keeps it open', async () => {
    postSpy.mockRejectedValue(new Error('network'));
    const user = await openCancel();
    await user.click(screen.getByRole('button', { name: /rfq\.detail\.cancelDialog\.confirm/ }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('rfq.detail.error.cancel'));
  });

  it('has no axe violations while open', async () => {
    await openCancel();
    await expectNoAxeViolations(screen.getByRole('dialog').parentElement as HTMLElement);
  });
});
