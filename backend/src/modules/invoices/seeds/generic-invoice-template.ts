/**
 * Seeded generic invoice template (feature 047, US6 / T027). A Puck content
 * envelope composed of the bounded invoice component set.
 *
 * Props on each node MUST mirror `defaultProps` in
 * `admin/.../invoice-puck-config.tsx` so the editor sidebar shows selected
 * radios/selects when a template is created from this seed (Puck does not
 * re-apply defaultProps onto already-persisted nodes).
 */
export const GENERIC_INVOICE_TEMPLATE_CODE = 'generic';
export const GENERIC_INVOICE_TEMPLATE_LANGUAGES = ['pl-PL', 'en-US'];

/**
 * Bump when the seeded Puck tree shape changes so `ensureGenericSeed` (and the
 * matching data migration) refresh the system `generic` row on existing DBs.
 */
export const GENERIC_INVOICE_TEMPLATE_SEED_REVISION = 2;

const DEFAULT_FOOTER_TEXT =
  'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}';

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
      {
        type: 'InvoiceHeader',
        props: {
          id: 'inv-header',
          titleSize: 14,
          titleColor: '#0f172a',
          titleBold: true,
          align: 'left',
          showIssuedAt: true,
          showSaleDate: true,
          showPaymentDue: true,
          showPaymentMethod: true,
          labelIssuedAt: 'Issue date',
          labelSaleDate: 'Sale date',
          labelPaymentDue: 'Payment due',
          labelPaymentMethod: 'Payment method',
          marginTop: 0,
          marginBottom: 12,
        },
      },
      {
        type: 'InvoiceSpacer',
        props: { id: 'inv-spacer-1', height: 8, backgroundColor: '' },
      },
      {
        type: 'InvoiceParties',
        props: {
          id: 'inv-parties',
          sellerLabel: 'Seller',
          buyerLabel: 'Buyer',
          showSellerBank: true,
          showSellerSwift: true,
          showBuyerTaxId: true,
          labelFontSize: 10,
          bodyFontSize: 10,
          columnGap: 16,
          sellerWidthPercent: 50,
          marginTop: 0,
          marginBottom: 16,
        },
      },
      {
        type: 'InvoiceLineItems',
        props: {
          id: 'inv-lines',
          fontSize: 8,
          headerBold: true,
          headerBackground: '',
          headerColor: '',
          borderColor: '#cbd5e1',
          zebra: false,
          showUnit: true,
          showQty: true,
          showUnitNet: true,
          showTaxRate: true,
          showNet: true,
          showGross: true,
          marginTop: 0,
          marginBottom: 12,
        },
      },
      {
        type: 'InvoiceVatSummary',
        props: {
          id: 'inv-vat',
          fontSize: 8,
          headerBold: true,
          headerBackground: '',
          headerColor: '',
          borderColor: '#cbd5e1',
          showTotalRow: true,
          totalLabel: 'Total',
          marginTop: 0,
          marginBottom: 12,
        },
      },
      {
        type: 'InvoiceTotals',
        props: {
          id: 'inv-totals',
          align: 'right',
          fontSize: 10,
          color: '#0f172a',
          amountDueColor: '',
          amountDueBold: true,
          amountInWordsItalics: true,
          showPaid: true,
          showAmountDue: true,
          showGross: true,
          showAmountInWords: true,
          labelPaid: 'Paid',
          labelAmountDue: 'Amount due',
          labelGross: 'Total',
          labelInWords: 'In words',
          marginTop: 0,
          marginBottom: 16,
        },
      },
      {
        type: 'InvoiceKsef',
        props: {
          id: 'inv-ksef',
          fontSize: 8,
          color: '#0f172a',
          showProcessedAt: true,
          hideWhenEmpty: true,
          labelNumber: 'KSeF number',
          labelProcessedAt: 'KSeF processed at',
          marginTop: 8,
          marginBottom: 0,
        },
      },
      {
        type: 'InvoiceFooter',
        props: {
          id: 'inv-footer',
          text: DEFAULT_FOOTER_TEXT,
          align: 'center',
          fontSize: 9,
          color: '#0f172a',
          bold: false,
          italics: false,
          showTopDivider: true,
          marginTop: 0,
          marginBottom: 8,
        },
      },
    ],
    zones: {},
  };
}

export const GENERIC_INVOICE_TEMPLATE_CONTENT = {
  schema_version: GENERIC_INVOICE_TEMPLATE_SEED_REVISION,
  languages: {
    'pl-PL': genericTree(),
    'en-US': genericTree(),
  },
} as Record<string, unknown>;
