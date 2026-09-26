import { describe, expect, it } from 'vitest';
import { InvoicePdfRenderer } from './invoice-pdf-renderer.js';
import { InvoicePdfBlockRegistry } from './invoice-pdf-block-registry.js';
import type { InvoiceDetail, InvoicePdfBlockRegistration } from '@endora-commerce/contracts';

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

/**
 * `specs/134-paid-module-extraction/` T063 / T126 — the contributed-block seam
 * on the renderer, the generalisation of `setKsefVerificationResolver`.
 *
 * Every render path goes through `content()`, so these assertions cover the
 * admin PDF, the regenerate, the customer download and the e-mail attachment
 * at once, which is what the single resolver used to do for one vendor.
 */
describe('InvoicePdfRenderer — contributed blocks', () => {
  function stamp(calls: { resolved: unknown[]; resolvedFor: string[] }, present = () => true) {
    const registry = new InvoicePdfBlockRegistry(() => present());
    const registration: InvoicePdfBlockRegistration = {
      name: 'acme.InvoiceStamp',
      moduleId: 'acme',
      describe: () => ({ label: 'Stamp', fields: {} }),
      resolve: async (invoiceId) => {
        calls.resolvedFor.push(invoiceId);
        return { code: `QR-${invoiceId}` };
      },
      render: ({ props, resolved }) => {
        calls.resolved.push(resolved);
        return { text: `stamp:${String(props['label'] ?? 'default')}` };
      },
    };
    registry.register(registration);
    return registry;
  }

  it('appends a present contributor’s block to the built-in layout, with the data it resolved', async () => {
    const calls = { resolved: [] as unknown[], resolvedFor: [] as string[] };
    const renderer = new InvoicePdfRenderer({ blocks: stamp(calls) });
    const content = await renderer.content(detail, 'pl');
    expect(content.at(-1)).toEqual({ text: 'stamp:default' });
    expect(calls.resolvedFor).toEqual([detail.id]);
    expect(calls.resolved).toEqual([{ code: `QR-${detail.id}` }]);
  });

  it('renders a stored contributed node from a template with its stored props', async () => {
    const calls = { resolved: [] as unknown[], resolvedFor: [] as string[] };
    const renderer = new InvoicePdfRenderer({ blocks: stamp(calls) });
    const tree = {
      content: [
        { type: 'invoices.InvoiceHeader', props: {} },
        { type: 'acme.InvoiceStamp', props: { label: 'custom' } },
      ],
    };
    const content = await renderer.content(detail, 'pl', tree);
    expect(content).toHaveLength(2);
    expect(content[1]).toEqual({ text: 'stamp:custom' });
  });

  it('asks nothing of a contributor whose block the template does not place', async () => {
    const calls = { resolved: [] as unknown[], resolvedFor: [] as string[] };
    const renderer = new InvoicePdfRenderer({ blocks: stamp(calls) });
    await renderer.content(detail, 'pl', { content: [{ type: 'invoices.InvoiceHeader', props: {} }] });
    expect(calls.resolvedFor).toEqual([]);
  });

  it('skips an absent contributor entirely — no render, no resolve — on both layouts', async () => {
    const calls = { resolved: [] as unknown[], resolvedFor: [] as string[] };
    const renderer = new InvoicePdfRenderer({ blocks: stamp(calls, () => false) });
    const builtin = await renderer.content(detail, 'pl');
    expect(JSON.stringify(builtin)).not.toContain('stamp:');
    const templated = await renderer.content(detail, 'pl', {
      content: [
        { type: 'invoices.InvoiceHeader', props: {} },
        { type: 'acme.InvoiceStamp', props: {} },
      ],
    });
    expect(templated).toHaveLength(1);
    expect(calls.resolvedFor).toEqual([]);
  });

  it('renders the block with null when its data cannot be resolved', async () => {
    const registry = new InvoicePdfBlockRegistry();
    const seen: unknown[] = [];
    registry.register({
      name: 'acme.InvoiceStamp',
      moduleId: 'acme',
      describe: () => ({ label: 'Stamp', fields: {} }),
      resolve: async () => {
        throw new Error('lookup failed');
      },
      render: ({ resolved }) => {
        seen.push(resolved);
        return { text: 'stamp' };
      },
    });
    const buf = await new InvoicePdfRenderer({ blocks: registry }).render(detail);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(seen).toEqual([null]);
  });

  it('carries no KSeF section of its own', async () => {
    // The built-in layout used to end with `ksefSection(inv)` — a sixth use of
    // the KSeF block the ruling's table did not list. With no contributor the
    // layout has nothing KSeF-shaped in it.
    const content = await new InvoicePdfRenderer().content(
      { ...detail, ksefReferenceNumber: '1234567890-20260722-ABC123-01' },
      'pl',
    );
    expect(JSON.stringify(content)).not.toContain('KSeF');
  });
});
