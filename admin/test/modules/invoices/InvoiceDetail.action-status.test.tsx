import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — "PDF regenerated"
 * and "Invoice sent" are said beside the header buttons that caused them, in
 * the `DetailHeaderActions` status region mounted before it has text, not as a
 * success banner under the header; and the screen keeps at most one banner
 * above the content — the error first, then "PDF not ready".
 */

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

const { InvoiceDetail } = await import(
  '../../../../packages/modules/invoices/src/admin/pages/InvoiceDetail'
);

const ID = '00000000-0000-4000-8000-0000000000aa';

const INVOICE = {
  id: ID,
  orderId: null,
  orderBusinessId: null,
  salesChannelId: null,
  kind: 'invoice',
  number: 'FV 1/2026',
  status: 'ready',
  currency: 'PLN',
  issuedAt: '2026-09-26T10:00:00.000Z',
  saleDate: '2026-09-26',
  paymentDueDate: null,
  paymentMethod: null,
  netTotal: 100,
  taxTotal: 23,
  grossTotal: 123,
  paidTotal: 0,
  amountDue: 123,
  total: 123,
  originalInvoiceId: null,
  templateId: null,
  pdfAssetId: null,
  ksefReferenceNumber: null,
  ksefProcessedAt: null,
  lines: [],
  vatSummary: [],
  seller: {
    legalName: 'Seller',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: 'PL',
    taxId: '',
    bankName: '',
    bankAccount: '',
    swift: '',
    email: '',
    phone: '',
  },
  buyer: { name: 'Buyer', taxId: '', addressLine1: '', addressLine2: '', postalCode: '', city: '', country: '' },
};

function renderDetail(invoice: typeof INVOICE = INVOICE): void {
  getSpy.mockResolvedValue({ data: invoice });
  renderWithSession(
    <MemoryRouter initialEntries={[`/invoices/${ID}`]}>
      <Routes>
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['invoices'] }),
      bundle: passthroughBundle('core', [
        'invoiceDetail.section.details',
        'invoiceDetail.action.regeneratePdf',
        'invoiceDetail.action.resendEmail',
        'invoiceDetail.regenerated',
        'invoiceDetail.regenerateError',
        'invoiceDetail.pdfNotReady',
      ]),
    },
  );
}

/** The header's status region — the live region inside the header actions group. */
function headerStatus(): HTMLElement {
  const group = document.querySelector('[data-slot="detail-header-actions"]');
  const region = group?.querySelector<HTMLElement>('[role="status"]');
  if (!region) throw new Error('no status region in the header actions');
  return region;
}

afterEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('InvoiceDetail — action results beside the header buttons (#1499)', () => {
  it('mounts the header status region empty, before any action', async () => {
    renderDetail();
    await screen.findByText('invoiceDetail.section.details');
    expect(headerStatus().textContent).toBe('');
  });

  it('says "PDF regenerated" in the header status region, with no success banner', async () => {
    renderDetail();
    await screen.findByText('invoiceDetail.section.details');
    const region = headerStatus();
    postSpy.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: 'invoiceDetail.action.regeneratePdf' }));

    await waitFor(() => expect(region).toHaveTextContent('invoiceDetail.regenerated'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('an error clears the previous result and is the one banner above the content', async () => {
    renderDetail({ ...INVOICE, status: 'pending' });
    await screen.findByText('invoiceDetail.section.details');
    expect(screen.getByText('invoiceDetail.pdfNotReady')).toBeInTheDocument();
    const region = headerStatus();
    postSpy.mockResolvedValueOnce({});
    await userEvent.click(screen.getByRole('button', { name: 'invoiceDetail.action.regeneratePdf' }));
    await waitFor(() => expect(region).toHaveTextContent('invoiceDetail.regenerated'));

    postSpy.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(screen.getByRole('button', { name: 'invoiceDetail.action.regeneratePdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invoiceDetail.regenerateError');
    expect(region.textContent).toBe('');
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(1);
    expect(screen.queryByText('invoiceDetail.pdfNotReady')).toBeNull();
  });
});
