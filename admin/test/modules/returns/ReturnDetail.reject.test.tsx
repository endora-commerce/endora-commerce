import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #311 — the Reject action asks for its reason in a design-system dialog,
 * not through the browser's `window.prompt()`: a required, multi-line reason
 * validated inline (empty, whitespace-only, over 2000 characters), a destructive
 * Reject button, Cancel and Escape to close with focus back on the opener, and
 * an API error shown inside the dialog.
 */

installOffsetParentShim();

const getSpy = vi.fn();
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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ReturnDetail } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDetail'
);

const CASE = {
  id: 'r1',
  rmaNumber: 'RMA-1',
  kind: 'return',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'new',
  statusLabel: 'New',
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
  consumerWithdrawal: false,
  alternativeResolutionConsent: null,
  items: [],
  comments: [],
  correctiveInvoice: null,
};

const BUNDLE = {
  ...passthroughBundle('returns', [
    'reject.action',
    'reject.dialogTitle',
    'reject.explanation',
    'reject.reason',
    'reject.reasonHint',
    'reject.confirm',
    'reject.cancel',
    'reject.rejectedInfo',
    'reject.error.reasonMissing',
    'reject.error.reasonTooLong',
  ]),
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: CASE });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
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

async function openDialog(): Promise<{ opener: HTMLElement; dialog: HTMLElement }> {
  const opener = await screen.findByRole('button', { name: 'reject.action' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'reject.dialogTitle' });
  return { opener, dialog };
}

describe('ReturnDetail — rejecting a return asks for the reason in a dialog (#311)', () => {
  it('never calls the browser prompt and opens a labelled dialog with the reason field focused', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    renderDetail();
    const { dialog } = await openDialog();
    expect(promptSpy).not.toHaveBeenCalled();
    const reason = within(dialog).getByRole('textbox', { name: 'reject.reason' });
    expect(reason.tagName).toBe('TEXTAREA');
    expect(reason).toHaveAttribute('required');
    expect(reason).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'reject.confirm' }).className).toMatch(/destructive/);
    promptSpy.mockRestore();
  });

  it('refuses an empty or whitespace-only reason inline and sends nothing', async () => {
    renderDetail();
    const { dialog } = await openDialog();
    const confirm = within(dialog).getByRole('button', { name: 'reject.confirm' });
    await userEvent.click(confirm);
    const reason = within(dialog).getByRole('textbox', { name: 'reject.reason' });
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('reject.error.reasonMissing')).toBeInTheDocument();
    await userEvent.type(reason, '   ');
    await userEvent.click(confirm);
    expect(within(dialog).getByText('reject.error.reasonMissing')).toBeInTheDocument();
    expect(reason).toHaveFocus();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('refuses a reason over 2000 characters inline', async () => {
    renderDetail();
    const { dialog } = await openDialog();
    const reason = within(dialog).getByRole('textbox', { name: 'reject.reason' }) as HTMLTextAreaElement;
    // A paste can exceed `maxLength` in some browsers; the check does not rely on it.
    reason.removeAttribute('maxlength');
    await userEvent.click(reason);
    await userEvent.paste('x'.repeat(2001));
    await userEvent.click(within(dialog).getByRole('button', { name: 'reject.confirm' }));
    expect(within(dialog).getByText('reject.error.reasonTooLong')).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason, closes the dialog and reports the rejection', async () => {
    postSpy.mockResolvedValue({ data: { ...CASE, statusCode: 'rejected' } });
    renderDetail();
    const { opener, dialog } = await openDialog();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'reject.reason' }), '  Out of the return window  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'reject.confirm' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/returns/r1/reject', { reason: 'Out of the return window' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('reject.rejectedInfo')).toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('shows an API error inside the dialog and keeps the typed reason', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'INVALID_TRANSITION', message: 'The case can no longer be rejected.' } }),
    );
    renderDetail();
    const { dialog } = await openDialog();
    const reason = within(dialog).getByRole('textbox', { name: 'reject.reason' });
    await userEvent.type(reason, 'Damaged by the customer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'reject.confirm' }));
    expect(await within(dialog).findByText('The case can no longer be rejected.')).toBeInTheDocument();
    expect(reason).toHaveValue('Damaged by the customer');
    expect(screen.getByRole('dialog', { name: 'reject.dialogTitle' })).toBeInTheDocument();
  });

  it('closes on Cancel and on Escape without sending, returning focus to Reject', async () => {
    renderDetail();
    const { opener, dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'reject.cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());

    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'reject.dialogTitle' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(postSpy).not.toHaveBeenCalled();
  });
});
