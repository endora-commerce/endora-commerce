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

const OTHER_METHOD = '00000000-0000-4000-8000-000000000999';

const PAYMENT_METHODS = [
  { id: OTHER_METHOD, code: 'transfer', name: { en: 'Bank transfer', pl: 'Przelew' } },
  { id: ORDER_METHOD, code: 'card', name: { en: 'Card', pl: 'Karta' } },
];

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
    'consent.evidence',
    'consent.record',
    'consent.change',
    'consent.revoke',
    'consent.revokeTitle',
    'consent.revokeExplanation',
    'consent.dialogTitle',
    'consent.changeDialogTitle',
    'consent.allRequired',
    'consent.replaceIntro',
    'consent.resolution',
    'consent.givenAt',
    'consent.givenAtHint',
    'consent.note',
    'consent.noteHint',
    'consent.save',
    'consent.cancel',
    'consent.recordedInfo',
    'consent.revokedInfo',
    'consent.frozen',
    'consent.requiredHint',
    'consent.goToPanel',
    'consent.needsConsent',
    'consent.error.resolution',
    'consent.error.givenAtMissing',
    'consent.error.givenAtFuture',
    'consent.error.givenAtBeforeFiled',
    'consent.error.note',
    'settlement.refundMethodDiffers',
    'settlement.orderMethod',
    'settlement.orderMethodUnnamed',
    'settlement.chooseMethod',
    'settlement.paymentMethodIdHint',
  ]),
};

let currentCase: Record<string, unknown> = CASE;
let currentPrefill: Record<string, unknown> = PREFILL;
let paymentMethods: unknown = null;

beforeEach(() => {
  currentCase = CASE;
  currentPrefill = PREFILL;
  paymentMethods = null;
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: currentCase });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    if (path === '/api/v1/admin/returns/r1/settlement') return Promise.resolve({ data: currentPrefill });
    if (path.startsWith('/api/v1/admin/payment-methods')) {
      return paymentMethods === null ? Promise.reject(new Error('forbidden')) : Promise.resolve({ data: paymentMethods });
    }
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

function resolutionRadio(value: string): HTMLInputElement {
  return screen.getByRole('radio', { name: new RegExp(`^returns\\.detail\\.resolution\\.${value}\\b`) }) as HTMLInputElement;
}

async function settlementLoaded(): Promise<void> {
  await screen.findByRole('radiogroup', { name: 'returns.detail.settlement.resolution' });
}

describe('ReturnDetail — a consumer withdrawal settles as a refund unless consent is on record (#905)', () => {
  it('starts on a refund to the order’s own payment method', async () => {
    renderDetail();
    await settlementLoaded();
    expect(resolutionRadio('refund')).toBeChecked();
    expect((screen.getByLabelText('returns.detail.settlement.paymentMethodId') as HTMLInputElement).value).toBe(
      ORDER_METHOD,
    );
    expect(screen.queryByText('settlement.refundMethodDiffers')).not.toBeInTheDocument();
  });

  it('keeps credit, replacement and repair closed, and says why beside each and below', async () => {
    renderDetail();
    await settlementLoaded();
    expect(resolutionRadio('refund')).not.toBeDisabled();
    for (const value of ['credit', 'replacement', 'repair']) {
      const radio = resolutionRadio(value);
      expect(radio).toBeDisabled();
      expect(radio).toHaveAccessibleName(new RegExp(`returns\\.detail\\.resolution\\.${value}.*consent\\.needsConsent`));
    }
    const hint = screen.getByText('consent.requiredHint');
    expect(hint.id).not.toBe('');
    expect(screen.getByRole('radiogroup', { name: 'returns.detail.settlement.resolution' })).toHaveAttribute(
      'aria-describedby',
      hint.id,
    );
  });

  it('moves focus to the consent panel from the hint', async () => {
    renderDetail();
    await settlementLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'consent.goToPanel' }));
    expect(document.activeElement?.id).toBe('consumer-withdrawal');
  });

  it('opens only the consented resolution', async () => {
    currentCase = { ...CASE, alternativeResolutionConsent: CONSENT };
    currentPrefill = { ...PREFILL, consentRequiredFor: ['replacement', 'repair'] };
    renderDetail();
    await settlementLoaded();
    expect(resolutionRadio('credit')).not.toBeDisabled();
    expect(resolutionRadio('repair')).toBeDisabled();
  });

  it('offers the payment methods by name, the order’s own first', async () => {
    paymentMethods = PAYMENT_METHODS;
    renderDetail();
    const select = (await screen.findByRole('combobox', { name: 'returns.detail.settlement.paymentMethodId' })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([ORDER_METHOD, OTHER_METHOD]);
    expect(options[1]).toHaveTextContent('Bank transfer');
    expect(select.value).toBe(ORDER_METHOD);
    expect(screen.queryByText('settlement.refundMethodDiffers')).not.toBeInTheDocument();
    await userEvent.selectOptions(select, OTHER_METHOD);
    const warning = screen.getByText('settlement.refundMethodDiffers');
    expect(select.getAttribute('aria-describedby')).toBe(warning.closest('[role="alert"]')?.id);
  });

  it('falls back to the method id, with a hint, when the list cannot be read', async () => {
    renderDetail();
    const input = (await screen.findByLabelText('returns.detail.settlement.paymentMethodId')) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAccessibleDescription('settlement.paymentMethodIdHint');
  });

  it('does not warn while the payment method field is empty', async () => {
    renderDetail();
    const input = (await screen.findByLabelText('returns.detail.settlement.paymentMethodId')) as HTMLInputElement;
    await userEvent.clear(input);
    expect(screen.queryByText('settlement.refundMethodDiffers')).not.toBeInTheDocument();
  });

  it('warns when the refund goes to another payment method, and still settles', async () => {
    postSpy.mockResolvedValue({ data: { totalRefundAmount: 50 } });
    renderDetail();
    const input = (await screen.findByLabelText('returns.detail.settlement.paymentMethodId')) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, OTHER_METHOD);
    expect(screen.getByText('settlement.refundMethodDiffers')).toBeInTheDocument();
    await userEvent.click(screen.getByText('returns.detail.settlement.settle'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/returns/r1/settlement',
        expect.objectContaining({ resolutionType: 'refund', refundPaymentMethodId: OTHER_METHOD }),
      ),
    );
  });

  it('marks the case with a warning badge', async () => {
    renderDetail();
    const badge = await screen.findByText('consent.badge');
    expect(badge.className).toContain('bg-amber-100');
  });
});

describe('ReturnDetail — the consumer’s consent is recorded and revoked by the operator (#905)', () => {
  it('records consent with a resolution, a date and an evidence note', async () => {
    postSpy.mockResolvedValue({ data: { ...CASE, alternativeResolutionConsent: CONSENT } });
    renderDetail();
    expect(await screen.findByText('consent.none')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'consent.record' }));

    const dialog = await screen.findByRole('dialog', { name: 'consent.dialogTitle' });
    expect(dialog).toHaveAccessibleDescription('consent.allRequired');
    // Nothing is preselected, and focus starts on the first answer.
    const group = within(dialog).getByRole('radiogroup', { name: 'consent.resolution' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(document.activeElement).toBe(within(group).getAllByRole('radio')[0]);
    // The date field says which zone it is read in.
    const givenAt = within(dialog).getByLabelText('consent.givenAt') as HTMLInputElement;
    expect(givenAt).toHaveAccessibleDescription('consent.givenAtHint');

    await userEvent.click(within(dialog).getByRole('radio', { name: 'returns.detail.resolution.repair' }));
    await userEvent.clear(givenAt);
    await userEvent.type(givenAt, '2026-11-03T10:00');
    await userEvent.type(within(dialog).getByLabelText('consent.note'), 'Customer e-mail, ticket #123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'consent.save' }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/returns/r1/alternative-consent', {
        resolution: 'repair',
        consentGivenAt: new Date('2026-11-03T10:00').toISOString(),
        note: 'Customer e-mail, ticket #123',
      }),
    );
  });

  it('says beside each field what is missing instead of disabling Save, and sends nothing', async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'consent.record' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'consent.save' });
    expect(save).not.toBeDisabled();
    const givenAt = within(dialog).getByLabelText('consent.givenAt') as HTMLInputElement;
    await userEvent.clear(givenAt);
    await userEvent.type(givenAt, '2026-10-01T10:00');
    await userEvent.click(save);

    const group = within(dialog).getByRole('radiogroup', { name: 'consent.resolution' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('consent.error.resolution');
    expect(givenAt).toHaveAttribute('aria-invalid', 'true');
    expect(givenAt).toHaveAccessibleDescription('consent.givenAtHint consent.error.givenAtBeforeFiled');
    const note = within(dialog).getByLabelText('consent.note');
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveAccessibleDescription('consent.noteHint consent.error.note');
    // Focus goes to the first field to fix.
    expect(document.activeElement).toBe(within(group).getAllByRole('radio')[0]);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('shows the recorded consent with its evidence, and revokes it only after confirmation', async () => {
    currentCase = { ...CASE, alternativeResolutionConsent: CONSENT };
    deleteSpy.mockResolvedValue({ data: { ...CASE, alternativeResolutionConsent: null } });
    renderDetail();
    expect(await screen.findByText('Customer e-mail, ticket #123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'consent.change' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'consent.revoke' }));

    const dialog = await screen.findByRole('dialog', { name: 'consent.revokeTitle' });
    expect(dialog).toHaveAccessibleDescription('consent.revokeExplanation');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'consent.cancel' }));
    expect(deleteSpy).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'consent.cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'consent.revoke' }));
    const again = await screen.findByRole('dialog', { name: 'consent.revokeTitle' });
    await userEvent.click(within(again).getByRole('button', { name: 'consent.revoke' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/returns/r1/alternative-consent'));
  });

  it('changes a recorded consent starting from what is on record', async () => {
    currentCase = { ...CASE, alternativeResolutionConsent: CONSENT };
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'consent.change' }));
    const dialog = await screen.findByRole('dialog', { name: 'consent.changeDialogTitle' });
    expect(dialog).toHaveAccessibleDescription('consent.replaceIntro');
    const credit = within(dialog).getByRole('radio', { name: 'returns.detail.resolution.credit' });
    expect(credit).toBeChecked();
    expect(document.activeElement).toBe(credit);
  });

  it('freezes the consent of a settled case', async () => {
    currentCase = { ...CASE, statusCode: 'resolved', resolutionType: 'credit', alternativeResolutionConsent: CONSENT };
    renderDetail();
    expect(await screen.findByText('consent.frozen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'consent.revoke' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'consent.record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'consent.change' })).not.toBeInTheDocument();
  });

  it('shows nothing of this to a case that is not a consumer withdrawal', async () => {
    currentCase = { ...CASE, consumerWithdrawal: false };
    currentPrefill = { ...PREFILL, consentRequiredFor: [] };
    renderDetail();
    await settlementLoaded();
    expect(resolutionRadio('credit')).not.toBeDisabled();
    expect(screen.queryByText('consent.panelTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('consent.requiredHint')).not.toBeInTheDocument();
    expect(screen.queryByText('consent.badge')).not.toBeInTheDocument();
  });
});

describe('consentFormErrors — the dialog’s rules, the server’s date rules included (#905)', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const base = {
    resolution: 'credit' as const,
    givenAt: '2026-11-03T10:00',
    note: 'E-mail',
    submittedAt: '2026-11-01T10:00:00Z',
    now,
  };

  it('passes a complete consent', async () => {
    const { consentFormErrors } = await import(
      '../../../../packages/modules/returns/src/admin/pages/ConsumerWithdrawalPanel'
    );
    expect(consentFormErrors(base)).toEqual({});
  });

  it('refuses a missing answer, a future or pre-filing date, and a blank note', async () => {
    const { consentFormErrors } = await import(
      '../../../../packages/modules/returns/src/admin/pages/ConsumerWithdrawalPanel'
    );
    expect(consentFormErrors({ ...base, resolution: null, note: '   ' })).toEqual({ resolution: 'resolution', note: 'note' });
    expect(consentFormErrors({ ...base, givenAt: '' }).givenAt).toBe('givenAtMissing');
    expect(consentFormErrors({ ...base, givenAt: new Date(now.getTime() + 3_600_000).toISOString() }).givenAt).toBe(
      'givenAtFuture',
    );
    expect(consentFormErrors({ ...base, givenAt: '2026-10-31T10:00:00Z' }).givenAt).toBe('givenAtBeforeFiled');
  });
});
