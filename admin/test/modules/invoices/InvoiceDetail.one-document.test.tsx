import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * Issue #1547 (UX audit 2026-11-17, SALES-25) — an invoice is one document, so
 * the screen draws it as one card (Common Region): Details, Seller and Buyer
 * under section headings, then the lines, with the VAT summary and the totals
 * as the lines table's footer, as the order detail does — not six cards.
 *
 * And the header resolves the point #1683 left open (DS-07, one primary per
 * view): the screen's one filled action is the next step for this invoice —
 * *Download PDF* once the PDF is ready, *Regenerate PDF* while it is pending —
 * and the rest sit in the "More" menu.
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
  overpayment: 0,
  total: 123,
  originalInvoiceId: null,
  templateId: null,
  pdfAssetId: null,
  ksefReferenceNumber: null,
  ksefProcessedAt: null,
  lines: [
    {
      ordinal: 1,
      name: 'Widget',
      unit: 'pcs',
      quantity: 2,
      unitNetPrice: 50,
      taxRate: 0.23,
      netValue: 100,
      grossValue: 123,
    },
  ],
  vatSummary: [{ taxRate: 0.23, netTotal: 100, vatAmount: 23, grossTotal: 123 }],
  seller: {
    legalName: 'Seller Sp. z o.o.',
    addressLine1: 'Main 1',
    addressLine2: '',
    postalCode: '00-001',
    city: 'Warsaw',
    country: 'PL',
    taxId: '1234567890',
    bankName: '',
    bankAccount: '',
    swift: '',
    email: '',
    phone: '',
  },
  buyer: {
    name: 'Buyer S.A.',
    taxId: '0987654321',
    addressLine1: 'Side 2',
    addressLine2: '',
    postalCode: '30-001',
    city: 'Cracow',
    country: 'PL',
  },
};

const KEYS = [
  'invoiceDetail.field.kind',
  'invoiceDetail.section.details',
  'invoiceDetail.section.seller',
  'invoiceDetail.section.buyer',
  'invoiceDetail.section.lines',
  'invoiceDetail.totals.net',
  'invoiceDetail.totals.tax',
  'invoiceDetail.totals.gross',
  'invoiceDetail.totals.due',
  'invoiceDetail.action.downloadPdf',
  'invoiceDetail.action.regeneratePdf',
  'invoiceDetail.action.resendEmail',
  'common.action.more',
];

async function renderDetail(
  invoice: Record<string, unknown> = INVOICE,
  permissions: string[] = ['*'],
): Promise<void> {
  getSpy.mockResolvedValue({ data: invoice });
  renderWithSession(
    <MemoryRouter initialEntries={[`/invoices/${ID}`]}>
      <Routes>
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: ['invoices'] }),
      bundle: passthroughBundle('core', KEYS),
    },
  );
  await screen.findByText('invoiceDetail.section.details');
}

function headerActions(): HTMLElement {
  const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]');
  if (!group) throw new Error('no header actions group');
  return group;
}

/** The filled buttons and links of the header — the primary actions. */
function primaryActions(): HTMLElement[] {
  return Array.from(headerActions().querySelectorAll<HTMLElement>('a, button')).filter((el) =>
    el.className.split(/\s+/).includes('bg-primary'),
  );
}

afterEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('InvoiceDetail — one card for one document (SALES-25)', () => {
  it('draws the document as a single card with section headings', async () => {
    await renderDetail();
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    for (const key of [
      'invoiceDetail.section.details',
      'invoiceDetail.section.seller',
      'invoiceDetail.section.buyer',
      'invoiceDetail.section.lines',
    ]) {
      expect(screen.getByRole('heading', { name: key })).toBeInTheDocument();
    }
    // No separate VAT summary or Totals section: four headings under the page's h1.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('lists the details as a description list', async () => {
    await renderDetail();
    const term = screen.getByText('invoiceDetail.field.kind');
    expect(term.tagName).toBe('DT');
    expect(term.closest('dl')).not.toBeNull();
  });

  it('carries the VAT summary and the totals in the lines table footer', async () => {
    await renderDetail();
    const table = screen.getByRole('table');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const tfoot = table.querySelector('tfoot');
    expect(tfoot).not.toBeNull();
    const foot = within(tfoot as HTMLElement);
    expect(foot.getByRole('rowheader', { name: /invoiceDetail\.vatRow/ })).toBeInTheDocument();
    for (const key of [
      'invoiceDetail.totals.net',
      'invoiceDetail.totals.tax',
      'invoiceDetail.totals.gross',
      'invoiceDetail.totals.due',
    ]) {
      expect(foot.getByRole('rowheader', { name: key })).toBeInTheDocument();
    }
  });
});

describe('InvoiceDetail — one primary action in the header (DS-07)', () => {
  it('a ready invoice: Download PDF is the one primary, the rest are in More', async () => {
    await renderDetail();
    const primaries = primaryActions();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('invoiceDetail.action.downloadPdf');
    expect(screen.queryByRole('button', { name: 'invoiceDetail.action.regeneratePdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'invoiceDetail.action.resendEmail' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'common.action.more' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'invoiceDetail.action.regeneratePdf' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'invoiceDetail.action.resendEmail' })).toBeInTheDocument();
  });

  it('a pending invoice: Regenerate PDF is the primary, there is no download', async () => {
    await renderDetail({ ...INVOICE, status: 'pending' });
    const primaries = primaryActions();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('invoiceDetail.action.regeneratePdf');
    expect(screen.queryByRole('link', { name: 'invoiceDetail.action.downloadPdf' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'common.action.more' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'invoiceDetail.action.resendEmail',
    ]);
  });

  it('without invoices:write only the download is offered, with no More menu', async () => {
    await renderDetail(INVOICE, ['invoices:read']);
    expect(primaryActions()).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'invoiceDetail.action.downloadPdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.action.more' })).toBeNull();
  });
});
