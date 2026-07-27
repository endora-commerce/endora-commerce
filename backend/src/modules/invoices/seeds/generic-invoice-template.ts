/**
 * Seeded generic invoice template (feature 047, US6 / T027). A Puck content
 * envelope composed of the bounded invoice component set.
 */
export const GENERIC_INVOICE_TEMPLATE_CODE = 'generic';
export const GENERIC_INVOICE_TEMPLATE_LANGUAGES = ['pl-PL', 'en-US'];

function genericTree() {
  return {
    root: { props: {} },
    content: [
      {
        type: 'InvoiceLogo',
        props: {
          id: 'inv-logo',
          imageSource: 'url',
          src: '',
          assetId: '',
          width: 140,
          maxHeight: 80,
          align: 'center',
          marginBottom: 12,
        },
      },
      { type: 'InvoiceHeader', props: { id: 'inv-header' } },
      { type: 'InvoiceSpacer', props: { id: 'inv-spacer-1', height: 8 } },
      { type: 'InvoiceParties', props: { id: 'inv-parties' } },
      { type: 'InvoiceLineItems', props: { id: 'inv-lines' } },
      { type: 'InvoiceVatSummary', props: { id: 'inv-vat' } },
      { type: 'InvoiceTotals', props: { id: 'inv-totals' } },
      { type: 'InvoiceKsef', props: { id: 'inv-ksef' } },
      {
        type: 'InvoiceFooter',
        props: {
          id: 'inv-footer',
          text: 'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}',
          align: 'center',
          fontSize: 9,
          showTopDivider: true,
        },
      },
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
