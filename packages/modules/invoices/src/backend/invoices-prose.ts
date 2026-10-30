import type { SupportedLanguage } from '@endora-commerce/contracts';

/**
 * The prose this module's backend composes for a reader whose language it
 * knows: the labels of a rendered invoice PDF, which carries its own
 * `language`, and the names of the lines an invoice itemises beside the
 * products, which are written in the invoice's language when it is issued
 * (`specs/conventions/module-i18n.md`, the case where the backend can resolve
 * the reader's language).
 *
 * The sentences live in this module's bundle; this table keeps their English
 * beside the code as the last tier, for when the bundle cannot answer.
 * `invoices-prose.test.ts` holds it equal to `i18n/en.json`.
 */
export const INVOICES_PROSE_EN = {
  'pdf.title.invoice': 'Invoice',
  'pdf.title.proforma': 'Proforma invoice',
  'pdf.title.correction': 'Corrective invoice',
  'pdf.title.wz': 'Goods dispatch note',
  'pdf.title.numbered': '{title} No. {number}',
  'pdf.label.ksefNumber': 'KSeF number',
  'pdf.label.issuedAt': 'Issue date',
  'pdf.label.saleDate': 'Sale date',
  'pdf.label.paymentDue': 'Payment due',
  'pdf.label.paymentMethod': 'Payment method',
  'pdf.label.seller': 'Seller',
  'pdf.label.buyer': 'Buyer',
  'pdf.label.taxId': 'Tax ID',
  'pdf.column.ordinal': 'No.',
  'pdf.column.name': 'Name',
  'pdf.column.unit': 'Unit',
  'pdf.column.quantity': 'Qty',
  'pdf.column.unitNet': 'Net price',
  'pdf.column.taxRate': 'Rate',
  'pdf.column.net': 'Net value',
  'pdf.column.gross': 'Gross value',
  'pdf.vat.rate': 'VAT rate',
  'pdf.vat.amount': 'VAT amount',
  'pdf.label.total': 'Total',
  'pdf.label.paid': 'Paid',
  'pdf.label.amountDue': 'Amount due',
  'pdf.label.overpayment': 'Overpayment',
  'pdf.label.inWords': 'In words',
  'pdf.footer.default': 'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}',
  'lines.item': 'Item',
  'lines.unit.piece': 'pcs',
  'lines.unit.service': 'svc',
  'lines.delivery': 'Delivery',
  'lines.paymentSurcharge': 'Payment method surcharge',
  'lines.discount': 'Discount',
} as const;

export type InvoicesProseKey = keyof typeof INVOICES_PROSE_EN;

export type ProseParams = Record<string, string | number>;

/**
 * `_i18n`'s `adminI18nService.translate`, bound to this module's bundle. It
 * answers `invoices.<key>` for a key no bundle carries.
 */
export type InvoicesTranslate = (
  key: string,
  language: SupportedLanguage,
  params?: ProseParams,
) => Promise<string>;

/** One sentence of this module's prose in `language`, English when the bundle cannot answer. */
export async function invoicesProse(
  translate: InvoicesTranslate | undefined,
  key: InvoicesProseKey,
  language: SupportedLanguage,
  params?: ProseParams,
): Promise<string> {
  if (translate) {
    try {
      const text = await translate(key, language, params);
      if (text !== `invoices.${key}`) return text;
    } catch {
      // The English tier below is the answer to an unreachable bundle.
    }
  }
  return fillPlaceholders(INVOICES_PROSE_EN[key], params);
}

/** Every key at once, for a renderer that draws synchronously. */
export async function invoicesProseTable<K extends InvoicesProseKey>(
  translate: InvoicesTranslate | undefined,
  keys: readonly K[],
  language: SupportedLanguage,
): Promise<Record<K, string>> {
  // One at a time: every lookup is a read of `_i18n`'s bundle table, and a
  // table of them at once would take that many pool connections together.
  const table = {} as Record<K, string>;
  for (const key of keys) table[key] = await invoicesProse(translate, key, language);
  return table;
}

export function fillPlaceholders(template: string, params?: ProseParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] != null ? String(params[name]) : match,
  );
}
