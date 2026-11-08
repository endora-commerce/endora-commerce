/**
 * Seeded generic invoice template (feature 047, US6 / T027). A Puck content
 * envelope composed of the bounded invoice component set.
 *
 * It is the *Invoice* document type's built-in layout
 * (`document/invoice-document-type.ts`), and the content a template started
 * from it copies. Every prop is spelled out so the editor sidebar shows
 * selected radios/selects (Puck does not re-apply defaultProps onto
 * already-persisted nodes). **Label props are empty** (issues #428, #437): an
 * empty label is drawn in the document's language, and a literal here would
 * be a template prop that wins over it.
 */
export const GENERIC_INVOICE_TEMPLATE_CODE = 'generic';
export const GENERIC_INVOICE_TEMPLATE_LANGUAGES = ['pl-PL', 'en-US'];

/**
 * Bump when the seeded Puck tree changes. It is the envelope's
 * `schema_version`; no stored row is rewritten on it since the seeded
 * `generic` row went with `invoice_templates` (`specs/152-compare-pdf-template/`).
 * Templates already stored are corrected by a migration of the module that
 * owns them, as `document_templates` does for issue #437 (revision 3).
 */
export const GENERIC_INVOICE_TEMPLATE_SEED_REVISION = 3;

/**
 * Empty on purpose (issue #437), like every label below: an empty footer text
 * prints `pdf.footer.default` in the document's language. A literal here is a
 * template prop, and a template prop wins over the translation — which is how
 * a Polish invoice came to say "Thank you for your business."
 */
const DEFAULT_FOOTER_TEXT = '';

function genericTree() {
  return {
    root: { props: {} },
    content: [
      {
        type: 'invoices.InvoiceLogo',
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
        type: 'invoices.InvoiceHeader',
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
          // Every label of the layout is empty (issue #437, after #428): the
          // block prints it in the document's language unless a template
          // sets its own.
          labelIssuedAt: '',
          labelSaleDate: '',
          labelPaymentDue: '',
          labelPaymentMethod: '',
          marginTop: 0,
          marginBottom: 12,
        },
      },
      {
        type: 'invoices.InvoiceSpacer',
        props: { id: 'inv-spacer-1', height: 8, backgroundColor: '' },
      },
      {
        type: 'invoices.InvoiceParties',
        props: {
          id: 'inv-parties',
          sellerLabel: '',
          buyerLabel: '',
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
        type: 'invoices.InvoiceLineItems',
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
        type: 'invoices.InvoiceVatSummary',
        props: {
          id: 'inv-vat',
          fontSize: 8,
          headerBold: true,
          headerBackground: '',
          headerColor: '',
          borderColor: '#cbd5e1',
          showTotalRow: true,
          totalLabel: '',
          marginTop: 0,
          marginBottom: 12,
        },
      },
      {
        type: 'invoices.InvoiceTotals',
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
          showOverpayment: true,
          showGross: true,
          showAmountInWords: true,
          labelPaid: '',
          labelAmountDue: '',
          labelOverpayment: '',
          labelGross: '',
          labelInWords: '',
          marginTop: 0,
          marginBottom: 16,
        },
      },
      // A `ksef.InvoiceSection` node stood here until feature 134's T063, and
      // this is the record of why it left. The comment that used to sit in
      // `pdf-components/descriptor.ts` said it first: the descriptor's owner
      // was *"derived from the name's owner segment rather than asserted: ten
      // of the eleven are `invoices`' and the eleventh, `ksef.InvoiceSection`,
      // is `ksef`'s (feature 096, T201). A literal here would have said
      // `invoices` for a block `invoices` does not own."* The eleventh was
      // different in kind — declared by another module and still seeded,
      // rendered, described and previewed here — so it went to the module
      // that declares it (`specs/134-paid-module-extraction/spec.md` §11.3,
      // exit E4). A free instance has no KSeF, so its generic template has no
      // KSeF section. Installing `ksef` does not put one back: the operator
      // places the block in the builder. Templates seeded before the change
      // keep their node — the seed revision is deliberately unchanged, so
      // nothing rewrites them — and it renders wherever `ksef` is present.
      {
        type: 'invoices.InvoiceFooter',
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
