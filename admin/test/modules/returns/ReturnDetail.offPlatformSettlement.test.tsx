import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * `specs/180-off-platform-complaints/` T078 (FR-B33, FR-B33a, D-5; design review R-5.7):
 * the settlement card of a case without a platform order.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnDetail } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnDetail');

const OFF_PLATFORM = {
  ...CASE_180,
  orderId: null,
  offPlatform: true,
  statusCode: 'authorized',
  statusLabel: 'Authorized',
  rmaNumber: 'RMA-9',
  reference: 'RMA-9',
  authorizedAt: '2026-11-02T10:00:00Z',
  authorizedBy: { adminUserId: null, name: null },
  items: [{ id: 'i1', orderItemId: null, productId: null, productName: 'Drill X200', quantity: 1, reasonId: null, description: 'x', inspectionOutcome: null, defaultRefundAmount: 0, approvedRefundAmount: 0, serialNumber: 'SN-1' }],
  resolutionNote: null,
};

const BUNDLE = {
  ...passthroughBundle('core', ['returns.detail.settlement.settle', 'returns.detail.settlement.title']),
  ...passthroughBundle('returns', [
  'settlement.offPlatformExplanation',
  'settlement.settledOutside',
  'settlement.note',
  'settlement.noteHint',
  'settlement.noteRequired',
  'detail.settledOutsideNote',
  ]),
};

let rc: Record<string, unknown>;
let options: string[];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  rc = { ...OFF_PLATFORM };
  options = ['settled_outside'];
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: rc });
    if (path === '/api/v1/admin/returns/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'authorized', isTerminal: false }], transitions: [] } });
    }
    if (path === '/api/v1/admin/returns/r1/settlement') {
      return Promise.resolve({
        data: {
          currency: 'PLN',
          resolutionOptions: options,
          defaultResolution: options.includes('repair') ? 'repair' : options[0],
          consentRequiredFor: [],
          defaultRefundPaymentMethodId: null,
          items: [{ returnCaseItemId: 'i1', productName: 'Drill X200', quantity: 1, defaultRefundAmount: 0, approvedRefundAmount: 0 }],
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: { totalRefundAmount: 0 } });
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

describe('ReturnDetail — settling a case without a platform order (180 T078)', () => {
  it('shows the card from authorized on, with the options the prefill gives and the reason refunds are absent', async () => {
    renderDetail();
    expect(await screen.findByText('settlement.offPlatformExplanation')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'settlement.settledOutside' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /refund/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('returns.detail.settlement.paymentMethodId')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'returns.detail.settlement.createCorrectiveInvoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('offers repair and replacement once the prefill does', async () => {
    options = ['replacement', 'repair', 'settled_outside'];
    rc = { ...OFF_PLATFORM, statusCode: 'received' };
    renderDetail();
    await screen.findByText('settlement.offPlatformExplanation');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('requires the note for settled_outside, with the error under the field and the focus there', async () => {
    renderDetail();
    await screen.findByText('settlement.offPlatformExplanation');
    await userEvent.click(screen.getByRole('button', { name: 'returns.detail.settlement.settle' }));
    const note = screen.getByLabelText('settlement.note');
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveFocus();
    expect(document.getElementById(note.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe('settlement.noteRequired');
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.type(note, 'Refunded in the store');
    await userEvent.click(screen.getByRole('button', { name: 'returns.detail.settlement.settle' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/r1/settlement', {
        resolutionType: 'settled_outside',
        lines: [],
        resolutionNote: 'Refunded in the store',
      }),
    );
  });

  it('shows the note on the Case card after settling', async () => {
    rc = { ...OFF_PLATFORM, statusCode: 'resolved', resolutionType: 'settled_outside', resolutionNote: 'Refunded in the store' };
    renderDetail();
    const card = (await screen.findByText('detail.settledOutsideNote')).closest('dl')!;
    expect(within(card).getByText('Refunded in the store')).toBeInTheDocument();
  });
});
