import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/api-client')>(
    '@/lib/api-client',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

// The Modify tab's product select and the overview's custom-field panel both
// pull their own data chains; neither is under test here.
vi.mock('@/modules/catalog/components/ProductPicker', () => ({
  ProductPicker: () => null,
}));
vi.mock('@/modules/custom_fields/CustomFieldValuesPanel', () => ({
  CustomFieldValuesPanel: () => null,
}));

const { RfqDetail } = await import('../../../src/modules/quote_requests/RfqDetail');

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const PRODUCT_ID = '00000000-0000-4000-8000-0000000000p1';

const BUNDLE = passthroughBundle('core', [
  'rfq.list.title',
  'rfq.detail.title',
  'rfq.detail.approve',
  'rfq.detail.badge.validityEnded',
  'rfq.detail.cancelRfq',
  'rfq.detail.convert.placeOrder',
  'rfq.detail.copyHint',
  'rfq.detail.tabs.overview',
  'rfq.detail.tabs.modify',
  'rfq.detail.tabs.history',
  'rfq.detail.modify.saveRevision',
  'rfq.detail.validity.field',
  'rfq.detail.validity.lapsed.setNewDeadline',
]);

/**
 * The bundle above resolves each key to itself; these are the keys whose
 * *interpolated* text the assertions read, so they carry a template.
 */
const INTERPOLATED: Record<string, string> = {
  'rfq.detail.validity.lapsed.headline': 'validity ended on {date}',
  'rfq.detail.validity.lapsed.remedyEditable': 'remedy: set a new deadline under Modify',
  'rfq.detail.validity.lapsed.remedyLocked': 'remedy: ask the customer to resubmit',
  'rfq.detail.validity.help.keepNone': 'no deadline is set',
  'rfq.detail.validity.help.keepActive': 'keep the current deadline, {date}',
  'rfq.detail.validity.help.keepLapsed': 'keep the deadline that has passed, {date}',
  'rfq.detail.validity.help.preview': 'saving sets the deadline to {date}',
  'rfq.detail.validity.help.previewImmediate': 'ends validity immediately ({date})',
  'rfq.detail.validity.error.days': 'enter a whole number of days',
  'rfq.detail.meta.expires': 'expires {date}',
  'rfq.detail.meta.validityEnded': 'validity ended {date}',
};

const FULL_BUNDLE = { core: { ...BUNDLE['core'], ...INTERPOLATED } };

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
    <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
      <Routes>
        <Route path="/quote-requests/:id" element={<RfqDetail />} />
      </Routes>
    </MemoryRouter>,
    FULL_BUNDLE,
  );
}

/** A deadline comfortably behind and ahead of whatever "now" the run has. */
const LAPSED_AT = '2026-01-01T00:00:00.000Z';
const futureIso = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

describe('RfqDetail — the operator sets and changes the validity deadline', () => {
  it('tells the operator a lapsed request is lapsed, and holds back the actions that can only be refused', async () => {
    renderDetail({ status: 'Pending', expiresAt: LAPSED_AT });

    expect(await screen.findByText('rfq.detail.badge.validityEnded')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('validity ended on');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'remedy: set a new deadline under Modify',
    );
    // The header no longer promises a date the platform has stopped honouring:
    // the same field renders through a different sentence once it is behind us.
    const meta = document.querySelector('header p')?.textContent ?? '';
    expect(meta).toContain('validity ended');
    expect(meta).not.toContain('expires');

    expect(screen.getByRole('button', { name: /rfq\.detail\.approve/ })).toBeDisabled();
  });

  it('says nothing about validity on a request the operator never dated', async () => {
    renderDetail({ status: 'Pending', expiresAt: null });

    await screen.findByText('rfq.detail.tabs.overview');
    expect(screen.queryByText('rfq.detail.badge.validityEnded')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rfq\.detail\.approve/ })).toBeEnabled();
  });

  it('an empty field on an undated request reads as "no deadline set", not as an empty box', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: null });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    expect(field).toHaveValue(null);
    expect(
      document.getElementById(field.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('no deadline is set');
  });

  it('an empty field on a dated request says which deadline staying empty keeps', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: futureIso(7) });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    expect(
      document.getElementById(field.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('keep the current deadline');
    // The header shows the same date as a promise still standing.
    expect(document.querySelector('header p')?.textContent ?? '').toContain('expires');
  });

  it('shows the resulting date before it is saved', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: LAPSED_AT });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    await user.type(field, '14');

    const help = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    const expected = new Date(Date.now() + 14 * 86_400_000).toLocaleString().slice(0, 10);
    expect(help).toHaveTextContent('saving sets the deadline to');
    expect(help?.textContent ?? '').toContain(expected);
  });

  it('says what a zero-day deadline does rather than looking like "no deadline"', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: futureIso(7) });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    await user.type(field, '0');

    expect(
      document.getElementById(field.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('ends validity immediately');
  });

  it('refuses a deadline the contract would refuse, and sends nothing', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: LAPSED_AT });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    await user.type(field, '2.5');
    expect(field).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
    expect(patchSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // The loop
  // ---------------------------------------------------------------------------

  it('re-dates a lapsed request with the same call the API-level loop proves', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: LAPSED_AT });

    // The operator meets the lapse on the overview and takes the remedy the
    // banner offers, rather than having to know that "Modify" is where dates
    // live.
    const banner = await screen.findByRole('alert');
    await user.click(
      within(banner).getByRole('button', { name: /rfq\.detail\.validity\.lapsed\.setNewDeadline/ }),
    );

    const field = screen.getByLabelText(/rfq\.detail\.validity\.field/);
    await waitFor(() => expect(field).toHaveFocus());

    await user.type(field, '14');
    await user.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [url, body, options] = patchSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];

    // Byte-for-byte the request the contract test
    // `backend/test/contract/quote_requests/expiry-enforcement.test.ts`
    // ("lets the operator re-date a lapsed request, after which the customer
    // can accept") makes on the operator's behalf.
    expect(url).toBe(`/api/v1/admin/quote-requests/${RFQ_ID}`);
    expect(body).toMatchObject({
      items: [{ productId: PRODUCT_ID, quantity: 5, agreedUnitPrice: 9 }],
      expiresInDays: 14,
    });
    expect(options.headers['If-Match']).toBe('"7"');
  });

  it('leaves the deadline untouched when the operator saves a revision without typing one', async () => {
    const user = userEvent.setup();
    renderDetail({ status: 'Pending', expiresAt: futureIso(7) });

    await user.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    await user.click(screen.getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const body = (patchSpy.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(body).not.toHaveProperty('expiresInDays');
  });

  // ---------------------------------------------------------------------------
  // The state the operator cannot repair
  // ---------------------------------------------------------------------------

  it('does not offer a re-date on an approved request, because `modify` refuses one', async () => {
    renderDetail({ status: 'Approved', expiresAt: LAPSED_AT, awaitingCustomerRevisionAcceptance: false });

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('remedy: ask the customer to resubmit');
    expect(
      within(banner).queryByRole('button', {
        name: /rfq\.detail\.validity\.lapsed\.setNewDeadline/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /rfq\.detail\.convert\.placeOrder/ }),
    ).toBeDisabled();
  });

  it('stays quiet on a request that is closed for another reason', async () => {
    renderDetail({ status: 'Canceled', expiresAt: LAPSED_AT, awaitingCustomerRevisionAcceptance: false });

    await screen.findByText('rfq.detail.tabs.overview');
    expect(screen.queryByText('rfq.detail.badge.validityEnded')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
