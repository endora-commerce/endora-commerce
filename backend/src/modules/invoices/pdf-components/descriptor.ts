import { INVOICE_COMPONENT_NAMES } from './tree-mapper.js';

/**
 * Page-builder descriptor for the invoice template WYSIWYG palette (US6).
 * Served to the admin editor so it can offer the bounded invoice component set.
 * Most components are data-bound (no fields); `InvoiceNotes` has an editable
 * text field that supports `{{var ...}}` interpolation.
 */
export interface InvoiceComponentField {
  type: 'text' | 'textarea';
  label: string;
}

export interface InvoiceComponentDescriptor {
  name: string;
  ownerModule: 'invoices';
  label: string;
  fields: Record<string, InvoiceComponentField>;
}

const LABELS: Record<string, string> = {
  InvoiceHeader: 'Header (number + dates)',
  InvoiceParties: 'Seller & buyer',
  InvoiceLineItems: 'Line items table',
  InvoiceVatSummary: 'VAT summary',
  InvoiceTotals: 'Totals & amount in words',
  InvoiceNotes: 'Notes (free text)',
  InvoiceKsef: 'KSeF verification',
};

export const INVOICE_PAGE_BUILDER_DESCRIPTOR = {
  schemaVersion: 1,
  components: INVOICE_COMPONENT_NAMES.map((name): InvoiceComponentDescriptor => ({
    name,
    ownerModule: 'invoices',
    label: LABELS[name] ?? name,
    fields:
      name === 'InvoiceNotes'
        ? { text: { type: 'textarea', label: 'Notes text' } }
        : {},
  })),
};
