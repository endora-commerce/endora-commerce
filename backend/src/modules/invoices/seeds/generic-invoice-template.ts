/**
 * Seeded generic invoice template (feature 047, US6 / T027). A Puck content
 * envelope composed of the bounded invoice component set; it reproduces the
 * built-in layout through the template path so per-channel customization starts
 * from a working default.
 */
export const GENERIC_INVOICE_TEMPLATE_CODE = 'generic';
export const GENERIC_INVOICE_TEMPLATE_LANGUAGES = ['pl-PL', 'en-US'];

function genericTree() {
  return {
    root: { props: {} },
    content: [
      { type: 'InvoiceHeader', props: { id: 'inv-header' } },
      { type: 'InvoiceParties', props: { id: 'inv-parties' } },
      { type: 'InvoiceLineItems', props: { id: 'inv-lines' } },
      { type: 'InvoiceVatSummary', props: { id: 'inv-vat' } },
      { type: 'InvoiceTotals', props: { id: 'inv-totals' } },
      { type: 'InvoiceKsef', props: { id: 'inv-ksef' } },
    ],
    zones: {},
  };
}

export const GENERIC_INVOICE_TEMPLATE_CONTENT = {
  schema_version: 1,
  languages: {
    'pl-PL': genericTree(),
    'en-US': genericTree(),
  },
} as Record<string, unknown>;
