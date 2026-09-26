import type { InvoiceTemplateBlockField } from '@endora-commerce/contracts';
import type { InvoicePdfBlockRegistry } from '../services/invoice-pdf-block-registry.js';
import { INVOICE_COMPONENT_NAMES } from './tree-mapper.js';

/**
 * Page-builder descriptor for the invoice template WYSIWYG palette (US6).
 * Served to the admin editor so it can offer the bounded invoice component set.
 *
 * The field shape is the published contract's, because a contributed block
 * describes its own fields (`specs/134-paid-module-extraction/` T063).
 */
export type InvoiceComponentField = InvoiceTemplateBlockField;

export interface InvoiceComponentDescriptor {
  name: string;
  ownerModule: string;
  label: string;
  fields: Record<string, InvoiceComponentField>;
}

const LABELS: Record<string, string> = {
  'invoices.InvoiceHeader': 'Header (number + dates)',
  'invoices.InvoiceParties': 'Seller & buyer',
  'invoices.InvoiceLineItems': 'Line items table',
  'invoices.InvoiceVatSummary': 'VAT summary',
  'invoices.InvoiceTotals': 'Totals & amount in words',
  'invoices.InvoiceNotes': 'Notes (free text)',
  'invoices.InvoiceSpacer': 'Spacer',
  'invoices.InvoiceDivider': 'Divider',
  'invoices.InvoiceLogo': 'Logo',
  'invoices.InvoiceFooter': 'Footer / legal',
};

const YES_NO = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

function radio(label: string): InvoiceComponentField {
  return { type: 'radio', label, options: YES_NO };
}

const SHARED_MARGIN: Record<string, InvoiceComponentField> = {
  marginTop: { type: 'number', label: 'Margin top (px)' },
  marginBottom: { type: 'number', label: 'Margin bottom (px)' },
};

const FIELDS: Record<string, Record<string, InvoiceComponentField>> = {
  'invoices.InvoiceHeader': {
    titleSize: { type: 'number', label: 'Title size' },
    titleColor: { type: 'color', label: 'Title color' },
    titleBold: radio('Title bold'),
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    showIssuedAt: radio('Show issue date'),
    showSaleDate: radio('Show sale date'),
    showPaymentDue: radio('Show payment due'),
    showPaymentMethod: radio('Show payment method'),
    labelIssuedAt: { type: 'text', label: 'Issue date label' },
    labelSaleDate: { type: 'text', label: 'Sale date label' },
    labelPaymentDue: { type: 'text', label: 'Payment due label' },
    labelPaymentMethod: { type: 'text', label: 'Payment method label' },
    // T137: the KSeF number row prints whenever the invoice has one and no
    // placed block prints it; the operator may relabel it and not hide it.
    labelKsefNumber: { type: 'text', label: 'KSeF number label' },
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceParties': {
    sellerLabel: { type: 'text', label: 'Seller label' },
    buyerLabel: { type: 'text', label: 'Buyer label' },
    showSellerBank: radio('Show seller bank'),
    showSellerSwift: radio('Show seller SWIFT'),
    showBuyerTaxId: radio('Show buyer tax ID'),
    labelFontSize: { type: 'number', label: 'Label font size' },
    bodyFontSize: { type: 'number', label: 'Body font size' },
    columnGap: { type: 'number', label: 'Column gap (px)' },
    sellerWidthPercent: { type: 'number', label: 'Seller width %' },
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceLineItems': {
    fontSize: { type: 'number', label: 'Font size' },
    headerBold: radio('Header bold'),
    headerBackground: { type: 'color', label: 'Header background' },
    headerColor: { type: 'color', label: 'Header text color' },
    borderColor: { type: 'color', label: 'Border color' },
    zebra: radio('Zebra rows'),
    showUnit: radio('Show unit'),
    showQty: radio('Show quantity'),
    showUnitNet: radio('Show unit net price'),
    showTaxRate: radio('Show tax rate'),
    showNet: radio('Show net value'),
    showGross: radio('Show gross value'),
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceVatSummary': {
    fontSize: { type: 'number', label: 'Font size' },
    headerBold: radio('Header bold'),
    headerBackground: { type: 'color', label: 'Header background' },
    headerColor: { type: 'color', label: 'Header text color' },
    borderColor: { type: 'color', label: 'Border color' },
    showTotalRow: radio('Show total row'),
    totalLabel: { type: 'text', label: 'Total row label' },
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceTotals': {
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    fontSize: { type: 'number', label: 'Font size' },
    color: { type: 'color', label: 'Text color' },
    amountDueColor: { type: 'color', label: 'Amount due color' },
    amountDueBold: radio('Amount due bold'),
    amountInWordsItalics: radio('Amount in words italics'),
    showPaid: radio('Show paid'),
    showAmountDue: radio('Show amount due'),
    showGross: radio('Show gross'),
    showAmountInWords: radio('Show amount in words'),
    labelPaid: { type: 'text', label: 'Paid label' },
    labelAmountDue: { type: 'text', label: 'Amount due label' },
    labelGross: { type: 'text', label: 'Gross label' },
    labelInWords: { type: 'text', label: 'In words label' },
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceNotes': {
    text: { type: 'textarea', label: 'Notes text' },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    fontSize: { type: 'number', label: 'Font size' },
    color: { type: 'color', label: 'Text color' },
    bold: radio('Bold'),
    italics: radio('Italics'),
    showTopDivider: radio('Top divider'),
    ...SHARED_MARGIN,
  },
  'invoices.InvoiceSpacer': {
    height: { type: 'number', label: 'Height (px)' },
    backgroundColor: { type: 'color', label: 'Background color' },
  },
  'invoices.InvoiceDivider': {
    thickness: { type: 'number', label: 'Thickness (px)' },
    color: { type: 'color', label: 'Color' },
    style: {
      type: 'select',
      label: 'Style',
      options: [
        { label: 'Solid', value: 'solid' },
        { label: 'Dashed', value: 'dashed' },
      ],
    },
    widthPercent: { type: 'number', label: 'Width %' },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    marginY: { type: 'number', label: 'Vertical margin (px)' },
  },
  'invoices.InvoiceLogo': {
    imageSource: {
      type: 'select',
      label: 'Image source',
      options: [
        { label: 'URL', value: 'url' },
        { label: 'Asset library', value: 'library' },
      ],
    },
    src: { type: 'text', label: 'Image URL' },
    assetId: { type: 'text', label: 'Image' },
    width: { type: 'number', label: 'Width (px)' },
    maxHeight: { type: 'number', label: 'Max height (px)' },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  'invoices.InvoiceFooter': {
    text: { type: 'textarea', label: 'Footer text' },
    align: {
      type: 'select',
      label: 'Align',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    fontSize: { type: 'number', label: 'Font size' },
    color: { type: 'color', label: 'Text color' },
    bold: radio('Bold'),
    italics: radio('Italics'),
    showTopDivider: radio('Top divider'),
    ...SHARED_MARGIN,
  },
};

/**
 * The descriptor `GET /api/v1/admin/invoice-templates/page-builder/config`
 * serves: this module's ten blocks, then every present contributor's.
 *
 * Built per request rather than held as a constant, because a contributor's
 * presence is read on every call — switching one off removes its block from
 * the palette description without a restart, and switching it on restores it.
 */
export function invoicePageBuilderDescriptor(blocks: InvoicePdfBlockRegistry): {
  schemaVersion: 1;
  components: InvoiceComponentDescriptor[];
} {
  return {
    schemaVersion: 1,
    components: [
      ...INVOICE_COMPONENT_NAMES.map(
        (name): InvoiceComponentDescriptor => ({
          name,
          ownerModule: 'invoices',
          label: LABELS[name] ?? name,
          fields: FIELDS[name] ?? {},
        }),
      ),
      ...blocks.present().map((block): InvoiceComponentDescriptor => {
        const { label, fields } = block.describe();
        return { name: block.name, ownerModule: block.moduleId, label, fields: { ...fields } };
      }),
    ],
  };
}
