import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #905, PR 2 (design D1, §6) — the settlement form of a consumer
 * withdrawal starts on a refund to the order's own payment method, keeps the
 * other resolutions closed until the consumer's consent is on record, and the
 * case detail records and revokes that consent.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

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
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ReturnDetail } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDetail'
);

const ORDER_METHOD = '00000000-0000-4000-8000-000000000905';

const CASE = {
  id: 'r1',
  rmaNumber: 'RMA-1',
  kind: 'return',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'received',
  statusLabel: 'Received',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  returnDeliveryMethodId: null,
  appliedReturnCost: 0,
  returnCostBearer: 'customer',
  freeReturnEligible: true,
  resolutionType: null,
  rejectionReason: null,
  consumerWithdrawal: true,
  alternativeResolutionConsent: null,
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
  correctiveInvoice: null,
};

const PREFILL = {
  currency: 'PLN',
  resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
  defaultResolution: 'refund',
  consentRequiredFor: ['credit', 'replacement', 'repair'],
  defaultRefundPaymentMethodId: ORDER_METHOD,
  items: [
    { returnCaseItemId: 'it1', productName: 'Widget', quantity: 1, defaultRefundAmount: 50, approvedRefundAmount: 50 },
  ],
};

const CONSENT = {
  resolution: 'credit',
  at: '2026-11-03T09:00:00.000Z',
  note: 'Customer e-mail, ticket #123',
  byAdminUserId: '00000000-0000-4000-8000-000000000007',
  source: 'operator_recorded',
};

const BUNDLE = {
  ...passthroughBundle('core', [
    'returns.detail.settlement.title',
    'returns.detail.settlement.resolution',
    'returns.detail.settlement.paymentMethodId',
    'returns.detail.settlement.settle',
    'returns.detail.resolution.refund',
    'returns.detail.resolution.credit',
    'returns.detail.resolution.replacement',
    'returns.detail.resolution.repair',
  ]),
  ...passthroughBundle('returns', [
    'consent.badge',
    'consent.panelTitle',
    'consent.explanation',
    'consent.none',
    'consent.recorded',
    'consent.evidence',
    'consent.record',
    'consent.revoke',
    'consent.dialogTitle',
    'consent.resolution',
    'consent.givenAt',
    'consent.note',
    'consent.noteHint',
    'consent.save',
    'consent.cancel',
    'consent.recordedInfo',
    'consent.revokedInfo',
    'consent.frozen',
    'consent.requiredHint',
    'settlement.refundMethodDiffers',
  ]),
};

let currentCase: Record<string, unknown> = CASE;
let currentPrefill: Record<string, unknown> = PREFILL;

beforeEach(() => {
  currentCase = CASE;
  currentPrefill = PREFILL;
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: currentCase });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    if (path === '/api/v1/admin/returns/r1/settlement') return Promise.resolve({ data: currentPrefill });
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

async function resolutionSelect(): Promise<HTMLSelectElement> {
  return (await screen.findByLabelText('returns.detail.settlement.resolution')) as HTMLSelectElement;
}

describe('ReturnDetail — a consumer withdrawal settles as a refund unless consent is on record (#905)', () => {
  it('starts on a refund to the order’s own payment method', async () => {
    renderDetail();
    expect((await resolutionSelect()).value).toBe('refund');
    expect((screen.getByLabelText('returns.detail.settlement.paymentMethodId') as HTMLInputElement).value).toBe(
      ORDER_METHOD,
    );
    expect(screen.queryByText('settlement.refundMethodDiffers')).not.toBeInTheDocument();
  });

  it('keeps credit, replacement and repair closed, and says why', async () => {
    renderDetail();
    const select = await resolutionSelect();
    const option = (value: string) => within(select).getByRole('option', { name: `returns.detail.resolution.${value}` });
    expect(option('refund')).not.toBeDisabled();
    for (const value of ['credit', 'replacement', 'repair']) expect(option(value)).toBeDisabled();
    const hint = screen.getByText('consent.requiredHint');
    expect(select).toHaveAttribute('aria-describedby', expect.stringContaining(hint.id));
  });

  it('opens only the consented resolution', async () => {
    currentCase = { ...CASE, alternativeResolutionConsent: CONSENT };
    currentPrefill = { ...PREFILL, consentRequiredFor: ['replacement', 'repair'] };
    renderDetail();
    const select = await resolutionSelect();
    expect(within(select).getByRole('option', { name: 'returns.detail.resolution.credit' })).not.toBeDisabled();
    expect(within(select).getByRole('option', { name: 'returns.detail.resolution.repair' })).toBeDisabled();
  });

  it('warns when the refund goes to another payment method, and still settles', async () => {
    postSpy.mockResolvedValue({ data: { totalRefundAmount: 50 } });
    renderDetail();
    const input = (await screen.findByLabelText('returns.detail.settlement.paymentMethodId')) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '00000000-0000-4000-8000-000000000999');
    expect(screen.getByText('settlement.refundMethodDiffers')).toBeInTheDocument();
    await userEvent.click(screen.getByText('returns.detail.settlement.settle'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/returns/r1/settlement',
        expect.objectContaining({ resolutionType: 'refund', refundPaymentMethodId: '00000000-0000-4000-8000-000000000999' }),
      ),
    );
  });
});

describe('ReturnDetail — the consumer’s consent is recorded and revoked by the operator (#905)', () => {
  it('records consent with a resolution, a date and an evidence note', async () => {
    postSpy.mockResolvedValue({ data: { ...CASE, alternativeResolutionConsent: CONSENT } });
    renderDetail();
    expect(await screen.findByText('consent.none')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'consent.record' }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'consent.save' });
    // The evidence note is mandatory.
    expect(save).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('consent.resolution'), 'repair');
    const givenAt = within(dialog).getByLabelText('consent.givenAt') as HTMLInputElement;
    await userEvent.clear(givenAt);
    await userEvent.type(givenAt, '2026-11-03T10:00');
    await userEvent.type(within(dialog).getByLabelText('consent.note'), 'Customer e-mail, ticket #123');
    await userEvent.click(save);

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/returns/r1/alternative-consent', {
        resolution: 'repair',
        consentGivenAt: new Date('2026-11-03T10:00').toISOString(),
        note: 'Customer e-mail, ticket #123',
      }),
    );
  });

  it('shows the recorded consent with its evidence, and revokes it', async () => {
    currentCase = { ...CASE, alternativeResolutionConsent: CONSENT };
    deleteSpy.mockResolvedValue({ data: { ...CASE, alternativeResolutionConsent: null } });
    renderDetail();
    expect(await screen.findByText('consent.recorded')).toBeInTheDocument();
    expect(screen.getByText('Customer e-mail, ticket #123')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'consent.revoke' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/returns/r1/alternative-consent'));
  });

  it('freezes the consent of a settled case', async () => {
    currentCase = { ...CASE, statusCode: 'resolved', resolutionType: 'credit', alternativeResolutionConsent: CONSENT };
    renderDetail();
    expect(await screen.findByText('consent.frozen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'consent.revoke' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'consent.record' })).not.toBeInTheDocument();
  });

  it('shows nothing of this to a case that is not a consumer withdrawal', async () => {
    currentCase = { ...CASE, consumerWithdrawal: false };
    currentPrefill = { ...PREFILL, consentRequiredFor: [] };
    renderDetail();
    const select = await resolutionSelect();
    expect(within(select).getByRole('option', { name: 'returns.detail.resolution.credit' })).not.toBeDisabled();
    expect(screen.queryByText('consent.panelTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('consent.requiredHint')).not.toBeInTheDocument();
  });
});
