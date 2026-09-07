import { describe, expect, it } from 'vitest';
import { treeToContent, pickLanguageTree } from './tree-mapper.js';
import { headerSection, lineItemsSection } from './sections.js';
import { sampleInvoiceDetail } from './sample.js';
import { GENERIC_INVOICE_TEMPLATE_CONTENT } from '../seeds/generic-invoice-template.js';

const inv = sampleInvoiceDetail();

describe('invoice template tree mapper (US6)', () => {
  it('maps known invoice components to pdfmake content', () => {
    const tree = {
      content: [
        { type: 'invoices.InvoiceHeader', props: {} },
        { type: 'invoices.InvoiceLineItems', props: {} },
        { type: 'invoices.InvoiceTotals', props: {} },
      ],
    };
    const content = treeToContent(tree, inv, 'pl');
    expect(content).not.toBeNull();
    expect(content).toHaveLength(3);
  });

  it('skips unknown components and falls back to null when nothing renders', () => {
    const tree = { content: [{ type: 'NotARealComponent', props: {} }] };
    expect(treeToContent(tree, inv, 'pl')).toBeNull();
  });

  it('returns null for a malformed tree (triggers built-in fallback)', () => {
    expect(treeToContent(null, inv, 'pl')).toBeNull();
    expect(treeToContent({}, inv, 'pl')).toBeNull();
  });

  it('renders InvoiceNotes with {{var}} interpolation', () => {
    const tree = { content: [{ type: 'invoices.InvoiceNotes', props: { text: 'Nr {{var invoice.number}}' } }] };
    const content = treeToContent(tree, inv, 'pl') as Array<{ stack?: Array<{ text: string }> }>;
    const text = content[0]?.stack?.find((n) => typeof n.text === 'string')?.text;
    expect(text).toBe('Nr INV-2026-0042');
  });

  it('picks the requested language tree from a content envelope', () => {
    const plTree = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'pl-PL') as { content: unknown[] };
    expect(Array.isArray(plTree.content)).toBe(true);
    const fallback = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'de-DE');
    expect(fallback).not.toBeNull();
  });

  it('the seeded generic tree renders all standard sections', () => {
    const tree = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'pl-PL');
    const content = treeToContent(tree, inv, 'pl');
    expect(content).not.toBeNull();
    expect(content!.length).toBeGreaterThanOrEqual(5);
  });

  it('maps layout components (spacer, divider, footer)', () => {
    const tree = {
      content: [
        { type: 'invoices.InvoiceSpacer', props: { height: 24 } },
        { type: 'invoices.InvoiceDivider', props: { thickness: 2, style: 'dashed' } },
        { type: 'invoices.InvoiceFooter', props: { text: 'Bye {{var seller.legalName}}' } },
      ],
    };
    const content = treeToContent(tree, inv, 'pl');
    expect(content).toHaveLength(3);
  });

  it('applies header personalization (hide sale date, custom label)', () => {
    const withDefaults = JSON.stringify(headerSection(inv, {}));
    const customized = headerSection(inv, {
      showSaleDate: false,
      labelIssuedAt: 'Issued',
      titleSize: 20,
    });
    const json = JSON.stringify(customized);
    expect(json).toContain('Issued:');
    expect(json).not.toContain('Data sprzedaży');
    expect(withDefaults).toContain('Data sprzedaży');
  });

  it('hides optional line-item columns when toggled off', () => {
    const full = lineItemsSection(inv, {});
    const slim = lineItemsSection(inv, {
      showUnit: false,
      showQty: false,
      showUnitNet: false,
      showTaxRate: false,
      showNet: false,
      showGross: false,
    });
    const fullWidths = (full as { table: { widths: unknown[] } }).table.widths;
    const slimWidths = (slim as { table: { widths: unknown[] } }).table.widths;
    expect(slimWidths.length).toBe(2); // Lp + Nazwa only
    expect(fullWidths.length).toBeGreaterThan(slimWidths.length);
  });
});
