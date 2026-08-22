import { describe, expect, it } from 'vitest';
import { InvoicePdfRenderer } from '../../../src/modules/invoices/services/invoice-pdf-renderer.js';
import type { InvoiceDetail } from '@endora-commerce/contracts';

const detail: InvoiceDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  orderId: '00000000-0000-4000-8000-000000000002',
  orderBusinessId: 'ORD-TEST-0001',
  salesChannelId: '00000000-0000-4000-8000-000000000003',
  kind: 'invoice',
  number: 'FV 26/2026',
  status: 'ready',
  currency: 'PLN',
  issuedAt: '2026-05-04T10:00:00.000Z',
  saleDate: '2026-05-04',
  paymentDueDate: '2026-05-18',
  paymentMethod: 'Przelew',
  netTotal: 5405,
  taxTotal: 1243.15,
  grossTotal: 6648.15,
  paidTotal: 0,
  amountDue: 6648.15,
  total: 6648.15,
  originalInvoiceId: null,
  templateId: null,
  pdfAssetId: null,
  ksefReferenceNumber: null,
  ksefProcessedAt: null,
  lines: [
    { ordinal: 1, name: 'Serwer', unit: 'szt.', quantity: 1, unitNetPrice: 900, taxRate: 0.23, netValue: 900, grossValue: 1107 },
    { ordinal: 2, name: 'Roboczogodziny', unit: 'h', quantity: 26.5, unitNetPrice: 170, taxRate: 0.23, netValue: 4505, grossValue: 5541.15 },
  ],
  vatSummary: [{ taxRate: 0.23, netTotal: 5405, vatAmount: 1243.15, grossTotal: 6648.15 }],
  seller: {
    legalName: 'Example Seller Sp. z o.o.',
    addressLine1: 'ul. Przykładowa 2',
    addressLine2: '',
    postalCode: '00-001',
    city: 'Warszawa',
    country: 'PL',
    taxId: '1234567890',
    bankName: 'Pekao',
    bankAccount: '31 1240',
    swift: 'PKOPPLPW',
    email: '',
    phone: '',
  },
  buyer: { name: 'Example Buyer Sp. z o.o.', taxId: '1231231230', addressLine1: '', addressLine2: '', postalCode: '', city: '', country: '' },
};

describe('InvoicePdfRenderer', () => {
  it('produces a valid PDF buffer from invoice detail', async () => {
    const buf = await new InvoicePdfRenderer().render(detail);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });
});
