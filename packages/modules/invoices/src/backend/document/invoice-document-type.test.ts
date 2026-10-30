import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentTemplateContentSchema,
  type DocumentRenderContext,
  type InvoiceDetail,
  type InvoiceDocumentData,
  type InvoicePdfBlockRegistration,
} from '@endora-commerce/contracts';
import { InvoicePdfBlockRegistry } from '../services/invoice-pdf-block-registry.js';
import { createInvoiceDocumentType, type InvoicePrepared } from './invoice-document-type.js';

/**
 * `specs/152-compare-pdf-template/` T055 — the Invoice document type, asserted
 * on **behaviour** (owner answer P1 replaced the golden parity of the first
 * design): an invoice PDF still carries everything an invoice requires —
 * seller and buyer, the lines, the VAT summary, the totals with the amount in
 * words, the correction note, the logo — and the KSeF number exactly once.
 *
 * The tree is walked here the way the engine walks it (prepare once, then each
 * placed block in order); the engine itself is covered by `document_templates`
 * and the composed paths by `backend/test/integration/invoices/`.
 */

const NUMBER = '1234567890-20260722-ABC123-01';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64');
const ASSET = '0f0e0d0c-0b0a-4908-8706-050403020100';

function invoice(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    orderId: '00000000-0000-4000-8000-000000000002',
    orderBusinessId: 'ORD-1',
    salesChannelId: '00000000-0000-4000-8000-0000000000a1',
    kind: 'invoice',
    number: 'FV 26/2026',
    status: 'ready',
    currency: 'PLN',
    issuedAt: '2026-05-04T10:00:00.000Z',
    saleDate: '2026-05-04',
    paymentDueDate: '2026-05-18',
    paymentMethod: 'Przelew',
    netTotal: 900,
    taxTotal: 207,
    grossTotal: 1107,
    paidTotal: 0,
    amountDue: 1107,
    overpayment: 0,
    total: 1107,
    originalInvoiceId: null,
    templateId: null,
    pdfAssetId: null,
    ksefReferenceNumber: null,
    ksefProcessedAt: null,
    lines: [{ ordinal: 1, name: 'Serwer ZX-1', unit: 'szt.', quantity: 1, unitNetPrice: 900, taxRate: 0.23, netValue: 900, grossValue: 1107 }],
    vatSummary: [{ taxRate: 0.23, netTotal: 900, vatAmount: 207, grossTotal: 1107 }],
    seller: {
      legalName: 'Sprzedawca Sp. z o.o.', addressLine1: 'ul. Długa 1', addressLine2: '', postalCode: '00-001', city: 'Warszawa',
      country: 'PL', taxId: '1111111111', bankName: 'Bank', bankAccount: 'PL00 1111', swift: 'BANKPLPW', email: '', phone: '',
    },
    buyer: { name: 'Nabywca S.A.', taxId: '2222222222', addressLine1: 'ul. Krótka 2', addressLine2: '', postalCode: '30-001', city: 'Kraków', country: 'PL' },
    ...over,
  };
}

const context: DocumentRenderContext = { documentType: 'invoices.invoice', language: 'pl-PL', salesChannelId: null, preview: false, pageWidth: 515 };

async function walk(
  type: ReturnType<typeof createInvoiceDocumentType>,
  tree: { content: { type: string; props: Record<string, unknown> }[] },
  data: InvoiceDocumentData,
): Promise<{ nodes: unknown[]; prepared: InvoicePrepared }> {
  const blocks = new Map(type.blocks().map((b) => [b.name, b]));
  const placed = tree.content.filter((n) => blocks.has(n.type));
  const prepared = await type.prepareRender!(data, { placedBlocks: new Set(placed.map((n) => n.type)), preview: false });
  const nodes: unknown[] = [];
  for (const node of placed) {
    nodes.push(await blocks.get(node.type)!.render({ props: node.props, data, prepared, language: 'pl-PL', context, interpolate: (t) => t }));
  }
  return { nodes, prepared };
}

const builtIn = (type: ReturnType<typeof createInvoiceDocumentType>) =>
  type.defaultContent().languages['pl-PL'] as { content: { type: string; props: Record<string, unknown> }[] };

function ksefBlock(opts: { reject?: boolean } = {}): InvoicePdfBlockRegistration {
  return {
    name: 'ksef.InvoiceSection',
    moduleId: 'ksef',
    printsKsefReferenceNumber: true,
    describe: () => ({ label: 'KSeF', fields: { caption: { type: 'text', label: 'Caption' } } }),
    resolve: async (id) => {
      if (opts.reject) throw new Error('down');
      return { link: `https://ksef.test/${id}` };
    },
    render: ({ invoice: inv, resolved }) => ({
      text: `Numer w KSeF: ${inv.ksefReferenceNumber ?? ''} ${resolved === null ? 'no-link' : (resolved as { link: string }).link}`,
    }),
  };
}

/** `adminI18nService.translate` over this module's real bundles, as production wires it (issue #95). */
const bundles: Record<string, Record<string, string>> = Object.fromEntries(
  ['en', 'pl'].map((language) => [
    language,
    JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>,
  ]),
);
const translate = async (key: string, language: string): Promise<string> =>
  bundles[language]?.[key] ?? bundles['en']?.[key] ?? `invoices.${key}`;

function setup(contributors: { block: InvoicePdfBlockRegistration; present: boolean }[] = []) {
  const presence = new Map(contributors.map((c) => [c.block.moduleId, c.present]));
  const registry = new InvoicePdfBlockRegistry((id) => presence.get(id) ?? true);
  for (const c of contributors) registry.register(c.block);
  const loadAssetImage = vi.fn(async (id: string) => (id === ASSET ? { bytes: PNG, mimeType: 'image/png' } : null));
  return {
    type: createInvoiceDocumentType({ contributed: registry, loadAssetImage, translate }),
    loadAssetImage,
    presence,
  };
}

const text = (v: unknown) => JSON.stringify(v);
const count = (v: unknown, needle: string) => text(v).split(needle).length - 1;

afterEach(() => vi.unstubAllGlobals());

describe('the Invoice document type — registration', () => {
  it('ten own blocks, then present contributors; no core blocks; default-only; Polish only', () => {
    const { type, presence } = setup([{ block: ksefBlock(), present: true }]);
    expect(type.blocks().map((b) => b.name)).toEqual([
      'invoices.InvoiceHeader', 'invoices.InvoiceParties', 'invoices.InvoiceLineItems', 'invoices.InvoiceVatSummary',
      'invoices.InvoiceTotals', 'invoices.InvoiceNotes', 'invoices.InvoiceSpacer', 'invoices.InvoiceDivider',
      'invoices.InvoiceLogo', 'invoices.InvoiceFooter', 'ksef.InvoiceSection',
    ]);
    presence.set('ksef', false);
    expect(type.blocks()).toHaveLength(10);
    expect(type.coreBlocks).toBe('none');
    expect(type.selection).toBe('default_only');
    expect(type.languages).toEqual(['pl-PL']);
    expect(type.pageDefaults).toMatchObject({ pageSize: 'A4', orientation: 'portrait', marginTop: 40, marginRight: 40, marginBottom: 48, marginLeft: 40, baseFontSize: 10 });
  });

  it('describes its own blocks with their fields, and a contributed one by its own describe()', () => {
    const { type } = setup([{ block: ksefBlock(), present: true }]);
    const header = type.blocks()[0]!.describe!();
    expect(header.label).toBe('Header (number + dates)');
    expect(header.fields['titleColor']).toEqual({ type: 'color', label: 'Title color' });
    expect(type.blocks().at(-1)!.describe!()).toEqual({ label: 'KSeF', fields: { caption: { type: 'text', label: 'Caption' } } });
  });

  it('ships a valid Polish built-in layout and a sample with the English amount in words', () => {
    const { type } = setup();
    expect(Object.keys(documentTemplateContentSchema.parse(type.defaultContent()).languages)).toEqual(['pl-PL']);
    expect(type.sampleData('pl-PL').amountLocale).toBe('en');
  });
});

describe('an invoice PDF carries what an invoice requires (FR-083)', () => {
  it('the built-in layout prints seller, buyer, lines, VAT summary, totals and amount in words', async () => {
    const { type } = setup();
    const { nodes } = await walk(type, builtIn(type), { invoice: invoice(), amountLocale: 'pl' });
    const all = text(nodes);
    for (const needle of ['FV 26/2026', 'Sprzedawca Sp. z o.o.', '1111111111', 'Nabywca S.A.', '2222222222', 'Serwer ZX-1', '23%', '1107', 'tysiąc sto siedem złotych']) {
      expect(all, needle).toContain(needle);
    }
  });

  it('a correction prints as a correction', async () => {
    const { type } = setup();
    const { nodes } = await walk(type, builtIn(type), {
      invoice: invoice({ kind: 'correction', number: 'FK 3/2026', originalInvoiceId: '00000000-0000-4000-8000-000000000009' }),
      amountLocale: 'pl',
    });
    expect(text(nodes)).toContain('FK 3/2026');
    expect(text(nodes)).toMatch(/korygując/i);
  });

  it('inlines the logo by asset and by URL, and never leaves a URL for pdfmake to fetch', async () => {
    vi.stubGlobal('fetch', async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    const { type, loadAssetImage } = setup();
    const { nodes } = await walk(
      type,
      {
        content: [
          { type: 'invoices.InvoiceLogo', props: { imageSource: 'library', assetId: ASSET } },
          { type: 'invoices.InvoiceLogo', props: { imageSource: 'url', src: 'https://cdn.test/logo.png' } },
        ],
      },
      { invoice: invoice(), amountLocale: 'pl' },
    );
    expect(loadAssetImage).toHaveBeenCalledWith(ASSET);
    expect(nodes.map((n) => (n as { image?: string }).image?.slice(0, 22))).toEqual(['data:image/png;base64,', 'data:image/png;base64,']);
  });
});

describe('the KSeF number is printed exactly once (134 T137)', () => {
  const withNumber = { invoice: invoice({ ksefReferenceNumber: NUMBER }), amountLocale: 'pl' as const };
  const placedTree = { content: [{ type: 'invoices.InvoiceHeader', props: {} }, { type: 'ksef.InvoiceSection', props: {} }] };

  it('by the header when no contributor prints it', async () => {
    const { type } = setup();
    expect(count((await walk(type, placedTree, withNumber)).nodes, NUMBER)).toBe(1);
  });

  it('by the header when the contributor is present but off', async () => {
    const { type } = setup([{ block: ksefBlock(), present: false }]);
    expect(count((await walk(type, placedTree, withNumber)).nodes, NUMBER)).toBe(1);
  });

  it('by the placed contributor, with the header standing down', async () => {
    const { type } = setup([{ block: ksefBlock(), present: true }]);
    const { nodes, prepared } = await walk(type, placedTree, withNumber);
    expect(prepared.suppressKsefNumber).toBe(true);
    expect(count(nodes[0], NUMBER)).toBe(0);
    expect(count(nodes[1], NUMBER)).toBe(1);
  });

  it('by the header when the contributor is present but not placed — and it is not resolved', async () => {
    const block = ksefBlock();
    const resolve = vi.spyOn(block, 'resolve');
    const { type } = setup([{ block, present: true }]);
    const { nodes } = await walk(type, { content: [{ type: 'invoices.InvoiceHeader', props: {} }] }, withNumber);
    expect(count(nodes, NUMBER)).toBe(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('a contributor whose data cannot be read renders with null and never fails the invoice', async () => {
    const { type } = setup([{ block: ksefBlock({ reject: true }), present: true }]);
    const { nodes } = await walk(type, placedTree, withNumber);
    expect(text(nodes[1])).toContain('no-link');
  });
});
