import { describe, expect, it } from 'vitest';
import { treeToContent, pickLanguageTree } from '../../../src/modules/invoices/pdf-components/tree-mapper.js';
import { sampleInvoiceDetail } from '../../../src/modules/invoices/pdf-components/sample.js';
import { GENERIC_INVOICE_TEMPLATE_CONTENT } from '../../../src/modules/invoices/seeds/generic-invoice-template.js';

const inv = sampleInvoiceDetail();

describe('invoice template tree mapper (US6)', () => {
  it('maps known invoice components to pdfmake content', () => {
    const tree = {
      content: [
        { type: 'InvoiceHeader', props: {} },
        { type: 'InvoiceLineItems', props: {} },
        { type: 'InvoiceTotals', props: {} },
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
    const tree = { content: [{ type: 'InvoiceNotes', props: { text: 'Nr {{var invoice.number}}' } }] };
    const content = treeToContent(tree, inv, 'pl') as Array<{ text: string }>;
    expect(content[0]?.text).toBe('Nr FV 26/2026');
  });

  it('picks the requested language tree from a content envelope', () => {
    const plTree = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'pl-PL') as { content: unknown[] };
    expect(Array.isArray(plTree.content)).toBe(true);
    // unknown language falls back to the first available
    const fallback = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'de-DE');
    expect(fallback).not.toBeNull();
  });

  it('the seeded generic tree renders all standard sections', () => {
    const tree = pickLanguageTree(GENERIC_INVOICE_TEMPLATE_CONTENT, 'pl-PL');
    const content = treeToContent(tree, inv, 'pl');
    expect(content).not.toBeNull();
    expect(content!.length).toBeGreaterThanOrEqual(5);
  });
});
