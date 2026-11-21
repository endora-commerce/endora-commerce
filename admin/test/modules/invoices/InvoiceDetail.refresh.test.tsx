import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1496 (UX audit SALES-06, on DS-14 #1447) — the invoice screen re-reads
 * after Regenerate PDF with the invoice still on screen, marked `aria-busy`,
 * instead of replacing the page with "Loading…"; the first load is a skeleton;
 * and a first load that fails is an error with a retry, not "Invoice not found".
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
  orderId: '00000000-0000-4000-8000-0000000000bb',
  orderBusinessId: 'ORD-1',
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

function renderDetail(readInvoice: () => Promise<unknown>): void {
  getSpy.mockImplementation(() => readInvoice());
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
        'common.state.loading',
        'common.action.retry',
        'invoiceDetail.error.load',
        'invoiceDetail.notFound',
        'invoiceDetail.section.details',
        'invoiceDetail.action.regeneratePdf',
        'common.action.more',
      ]),
    },
  );
}

afterEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('InvoiceDetail — first load and refresh (SALES-06)', () => {
  it('shows a busy skeleton region on the first load', async () => {
    let release!: () => void;
    renderDetail(() => new Promise((resolve) => (release = () => resolve({ data: INVOICE }))));

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('common.state.loading');

    release();
    expect(await screen.findByText('invoiceDetail.section.details')).toBeInTheDocument();
  });

  it('keeps the invoice on screen and busy while it re-reads after Regenerate PDF', async () => {
    const reads: Array<(value: unknown) => void> = [];
    renderDetail(() => new Promise((resolve) => reads.push(resolve)));
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ data: INVOICE });
    const heading = await screen.findByText('invoiceDetail.section.details');
    postSpy.mockResolvedValue({});

    // On a ready invoice Regenerate PDF is an entry of the header's "More" menu (#1547).
    await userEvent.click(screen.getByRole('button', { name: 'common.action.more' }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'invoiceDetail.action.regeneratePdf' }));

    await waitFor(() => expect(reads).toHaveLength(2));
    expect(heading).toBeInTheDocument();
    expect(heading.closest('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="detail-skeleton"]')).toBeNull();

    reads[1]!({ data: INVOICE });
    await waitFor(() => expect(heading.closest('[aria-busy="true"]')).toBeNull());
    expect(heading).toBeInTheDocument();
  });

  it('a first load that fails is an error with a retry, not "not found"', async () => {
    let attempt = 0;
    renderDetail(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: INVOICE });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('invoiceDetail.error.load');
    expect(screen.queryByText('invoiceDetail.notFound')).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: 'common.action.retry' }));
    expect(await screen.findByText('invoiceDetail.section.details')).toBeInTheDocument();
  });
});
