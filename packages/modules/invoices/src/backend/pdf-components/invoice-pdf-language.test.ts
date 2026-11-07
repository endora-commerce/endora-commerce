import { readFileSync } from 'node:fs';

import type { InvoiceDocumentData, SupportedLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { createInvoiceDocumentType } from '../document/invoice-document-type.js';
import { INVOICES_PROSE_EN, invoicesProseTable } from '../invoices-prose.js';
import { GENERIC_INVOICE_TEMPLATE_CONTENT } from '../seeds/generic-invoice-template.js';
import { sampleInvoiceDetail } from './sample.js';
import { INVOICE_PDF_LABEL_KEYS, type InvoicePdfLabels } from './sections.js';
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

function renderAll(labels: InvoicePdfLabels): Record<string, unknown> {
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

/**
 * Issue #437 — the built-in layout stored English literals in its label props
 * (`labelPaid: 'Paid'`, the footer's "Thank you for your business."), and a
 * template prop wins over the translation, so a Polish invoice printed them.
 * The layout leaves every label empty now, and an empty label is drawn in the
 * document's language.
 */
describe('invoice PDF — the built-in layout in Polish (issue #437)', () => {
  const type = createInvoiceDocumentType({
    contributed: { present: () => [] } as never,
    loadAssetImage: async () => null,
    translate: bundleTranslate,
  });

  async function renderLayout(
    language: string,
    over: (node: SeedNode) => Record<string, unknown> = (node) => node.props,
  ): Promise<string> {
    const layout = type.defaultContent().languages[language] as unknown as { content: SeedNode[] };
    const data: InvoiceDocumentData = { invoice: { ...invoice, kind: 'invoice' }, amountLocale: 'pl' };
    const out: unknown[] = [];
    for (const node of layout.content) {
      const block = type.blocks().find((candidate) => candidate.name === node.type)!;
      out.push(
        await block.render({
          props: over(node),
          data,
          prepared: { resolved: new Map(), suppressKsefNumber: false },
          language,
          context: {} as never,
          interpolate: (text) => text,
        }),
      );
    }
    return JSON.stringify(out);
  }

  /** Every PDF text the English bundle has and the Polish one words differently. */
  const english = (): string[] => {
    const en = bundle('en');
    const pl = bundle('pl');
    return Object.keys(en)
      .filter((key) => key.startsWith('pdf.') && key !== 'pdf.title.numbered' && en[key] !== pl[key])
      .map((key) => en[key]!.split('\n')[0]!);
  };

  it('prints no English label on a Polish invoice', async () => {
    const text = await renderLayout('pl-PL');
    for (const label of english()) expect(text, label).not.toContain(`"${label}`);
    expect(text).toContain('"Zapłacono: ');
    expect(text).toContain('"Do zapłaty: ');
    expect(text).toContain('"Sprzedawca"');
    expect(text).toContain('Dziękujemy za współpracę.\\nAcme Supplies Ltd. · NIP 12-3456789');
  });

  it('keeps a label the operator typed, in whatever language they typed it', async () => {
    const text = await renderLayout('pl-PL', (node) =>
      node.type === 'invoices.InvoiceTotals' ? { ...node.props, labelPaid: 'Paid' } : node.props,
    );
    expect(text).toContain('"Paid: ');
    expect(text).toContain('"Do zapłaty: ');
  });

  it('leaves every label prop of the layout empty, in every language', () => {
    for (const [language, tree] of Object.entries(
      GENERIC_INVOICE_TEMPLATE_CONTENT.languages as Record<string, { content: SeedNode[] }>,
    )) {
      for (const node of tree.content) {
        for (const [key, value] of Object.entries(node.props)) {
          if (/label/i.test(key) && !/fontsize/i.test(key)) expect(value, `${language} ${node.type}.${key}`).toBe('');
        }
        if (node.type === 'invoices.InvoiceFooter') expect(node.props['text'], language).toBe('');
      }
    }
  });
});
