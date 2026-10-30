import { readFileSync } from 'node:fs';

import type { InvoiceDocumentData, SupportedLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { createInvoiceDocumentType } from '../document/invoice-document-type.js';
import { INVOICES_PROSE_EN, invoicesProseTable } from '../invoices-prose.js';
import { GENERIC_INVOICE_TEMPLATE_CONTENT } from '../seeds/generic-invoice-template.js';
import { sampleInvoiceDetail } from './sample.js';
import { INVOICE_PDF_LABEL_KEYS } from './sections.js';
import { INVOICE_COMPONENT_NAMES, renderOwnBlock } from './tree-mapper.js';

/**
 * Issue #95 (`invoices`) — the labels a rendered invoice draws without a
 * template prop were Polish whatever the document's language. They are drawn
 * in the document's `language` now, from this module's bundle, English when
 * the bundle cannot answer.
 *
 * Invoices are printed in Polish (owner answer N5), so the Polish render is
 * held byte for byte to `invoice-pdf-pl.fixture.json` — the pdfmake content
 * the renderer produced before the labels moved, for every own block with its
 * in-code defaults, with the built-in layout's props, and for every title.
 */

const bundle = (language: SupportedLanguage): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

function bundleTranslate(
  key: string,
  language: SupportedLanguage,
  params?: Record<string, string | number>,
): Promise<string> {
  const template = bundle(language)[key] ?? bundle('en')[key];
  if (template === undefined) return Promise.resolve(`invoices.${key}`);
  return Promise.resolve(
    template.replace(/\{(\w+)\}/g, (match, name: string) =>
      params?.[name] != null ? String(params[name]) : match,
    ),
  );
}

const invoice = {
  ...sampleInvoiceDetail(),
  kind: 'correction' as const,
  ksefReferenceNumber: 'KSEF-1',
  paidTotal: 2450,
  amountDue: 0,
  overpayment: 50,
  currency: 'PLN',
};

type SeedNode = { type: string; props: Record<string, unknown> };
const seed = (
  GENERIC_INVOICE_TEMPLATE_CONTENT.languages as Record<string, { content: SeedNode[] }>
)['pl-PL']!.content;

function renderAll(labels: Awaited<ReturnType<typeof invoicesProseTable>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of ['invoice', 'proforma', 'correction', 'wz'] as const) {
    out[`header.${kind}`] = renderOwnBlock('invoices.InvoiceHeader', {}, { ...invoice, kind }, 'pl', { labels });
  }
  for (const name of INVOICE_COMPONENT_NAMES) {
    out[`defaults.${name}`] = renderOwnBlock(name, {}, invoice, 'pl', { labels });
  }
  for (const node of seed) {
    out[`seed.${node.type}`] = renderOwnBlock(node.type, node.props, invoice, 'pl', { labels });
  }
  return out;
}

describe('invoice PDF — labels in the document language', () => {
  it('draws the Polish invoice byte for byte as before, from the Polish bundle', async () => {
    const labels = await invoicesProseTable(bundleTranslate, INVOICE_PDF_LABEL_KEYS, 'pl');
    const expected = readFileSync(new URL('./invoice-pdf-pl.fixture.json', import.meta.url), 'utf8');
    expect(JSON.stringify(renderAll(labels), null, 2) + '\n').toBe(expected);
  });

  it('draws an English document in English', async () => {
    const labels = await invoicesProseTable(bundleTranslate, INVOICE_PDF_LABEL_KEYS, 'en');
    const text = JSON.stringify(renderAll(labels));
    expect(text).toContain('Corrective invoice No. INV-2026-0042');
    expect(text).toContain('"Sale date: 2026-05-04"');
    expect(text).toContain('"Net value"');
    expect(text).toContain('"VAT amount"');
    expect(text).toContain('"In words: ');
    expect(text).toContain('Thank you for your business.\\nAcme Supplies Ltd. · Tax ID 12-3456789');
    expect(text).not.toMatch(/Faktura|Data sprzedaży|Wartość|Słownie|Dziękujemy|NIP/);
  });

  it('draws English in code when no translator is wired', async () => {
    const labels = await invoicesProseTable(undefined, INVOICE_PDF_LABEL_KEYS, 'pl');
    expect(labels['pdf.label.saleDate']).toBe(INVOICES_PROSE_EN['pdf.label.saleDate']);
  });

  it('resolves the labels in the language the document type is rendered in', async () => {
    const type = createInvoiceDocumentType({
      contributed: { present: () => [] } as never,
      loadAssetImage: async () => null,
      translate: bundleTranslate,
    });
    const header = type.blocks().find((block) => block.name === 'invoices.InvoiceHeader')!;
    const data: InvoiceDocumentData = { invoice: { ...invoice, kind: 'invoice' }, amountLocale: 'pl' };
    const render = (language: string) =>
      header.render({
        props: {},
        data,
        prepared: { resolved: new Map(), suppressKsefNumber: false },
        language,
        context: {} as never,
        interpolate: (text) => text,
      });

    expect(JSON.stringify(await render('pl-PL'))).toContain('Faktura nr INV-2026-0042');
    expect(JSON.stringify(await render('en-US'))).toContain('Invoice No. INV-2026-0042');
  });
});
