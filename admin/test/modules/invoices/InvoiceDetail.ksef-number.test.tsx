import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';

/**
 * `specs/134-paid-module-extraction/` T137 (`research.md` D22 §3(a)), admin
 * half — the invoice screen shows the invoice's KSeF number itself.
 *
 * The number is `invoices`' stored statutory data, written by whichever path
 * delivered the invoice. Until T137 this screen showed it only through the
 * `invoice.detail.after` zone, which the KSeF module contributes, so with that
 * module off an operator saw no number on an invoice that has one. The zone is
 * untouched and the presence projection here names `invoices` alone — the row
 * must not depend on any other module being present.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { InvoiceDetail } = await import(
  '../../../../packages/modules/invoices/src/admin/pages/InvoiceDetail'
);

const LABEL = 'invoiceDetail.field.ksefNumber';

function invoice(ksefReferenceNumber: string | null): unknown {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
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
    ksefReferenceNumber,
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
}

async function renderDetail(ksefReferenceNumber: string | null): Promise<void> {
  getSpy.mockResolvedValue({ data: invoice(ksefReferenceNumber) });
  renderWithSession(
    <MemoryRouter initialEntries={['/invoices/00000000-0000-4000-8000-0000000000aa']}>
      <Routes>
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['invoices'] }),
      bundle: passthroughBundle('core', [LABEL, 'invoiceDetail.field.kind']),
    },
  );
  await screen.findByText('invoiceDetail.field.kind');
}

afterEach(() => {
  getSpy.mockReset();
});

describe('InvoiceDetail — the KSeF number row (134 T137)', () => {
  it('shows the number when the invoice has one', async () => {
    await renderDetail('1234567890-20260726-ABC-01');
    expect(screen.getByText(LABEL)).toBeDefined();
    expect(screen.getByText('1234567890-20260726-ABC-01')).toBeDefined();
  });

  it('shows no row when it has none', async () => {
    await renderDetail(null);
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
