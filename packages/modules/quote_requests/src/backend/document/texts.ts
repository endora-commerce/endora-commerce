/**
 * Every text the quote PDF prints on its own — the line field catalogue's
 * names, the totals' names, the built-in layout and the blocks' default labels
 * — in the two languages the platform ships
 * (`specs/153-quote-request-pdf-template/research.md` R-20).
 *
 * The one place Polish prose sits in this module's backend code
 * (Constitution VIII: user-facing strings ship in Polish and English). Any
 * other language reads English; an operator's own labels in a template's
 * language layout replace these.
 */

export type QuoteDocumentLanguage = 'en-US' | 'pl-PL';

export interface QuoteDocumentTexts {
  readonly fields: Readonly<Record<string, string>>;
  readonly groups: Readonly<Record<'line' | 'pricing' | 'product', string>>;
  readonly totals: Readonly<Record<string, string>>;
  readonly status: Readonly<Record<string, string>>;
  readonly header: {
    readonly title: string;
    readonly number: string;
    readonly issueDate: string;
    readonly validUntil: string;
    readonly revision: string;
  };
  readonly parties: {
    readonly buyer: string;
    readonly taxId: string;
    readonly customer: string;
    readonly salesRep: string;
  };
  readonly notes: string;
  readonly details: string;
  readonly emptyLines: string;
  readonly netPricesNote: string;
  readonly attributeSample: string;
  /** The editor's sample quote — invented, in the language being edited. */
  readonly sample: {
    readonly headerNote: string;
    readonly channelName: string;
    readonly orderNumberLabel: string;
    readonly siteLabel: string;
    readonly siteValue: string;
    readonly packaging: string;
    readonly lineNote: string;
    /** Feature 159 — the sample's two line groups. */
    readonly groupFasteners: string;
    readonly groupMounting: string;
  };
}

export const QUOTE_DOCUMENT_TEXTS: Readonly<Record<QuoteDocumentLanguage, QuoteDocumentTexts>> = {
  'en-US': {
    fields: {
      productName: 'Product',
      variant: 'Variant',
      sku: 'SKU',
      quantity: 'Quantity',
      packagingUnit: 'Packaging unit',
      packagingQuantity: 'Quantity in packaging units',
      listUnitPrice: 'List price',
      proposedUnitPrice: "Customer's proposed price",
      unitPrice: 'Price after discount',
      unitGrossPrice: 'Gross unit price',
      discountPercent: 'Discount %',
      unitDiscount: 'Unit discount',
      lineDiscount: 'Line discount',
      lineListValue: 'Value at list price',
      lineNet: 'Net value',
      vatRate: 'VAT rate',
      lineVat: 'VAT',
      lineGross: 'Gross value',
      lineNote: 'Line note',
      productUrl: 'Product page URL',
    },
    groups: { line: 'Line', pricing: 'Pricing', product: 'Product attributes' },
    totals: {
      listTotal: 'Total at list prices',
      discountTotal: 'Discounts',
      netTotal: 'Total net',
      vatRate: 'VAT rate',
      vatTotal: 'VAT',
      grossTotal: 'Total gross',
    },
    status: {
      'Created from admin': 'Created by the sales team',
      Pending: 'Pending',
      Approved: 'Approved',
      Canceled: 'Canceled',
      Completed: 'Completed',
      Expired: 'Expired',
    },
    header: {
      title: 'Quote',
      number: 'Quote number:',
      issueDate: 'Date:',
      validUntil: 'Valid until:',
      revision: 'Revision:',
    },
    parties: { buyer: 'Buyer', taxId: 'Tax ID:', customer: 'Contact', salesRep: 'Your sales representative' },
    notes: 'Notes',
    details: 'Details',
    emptyLines: 'This quote has no lines.',
    netPricesNote: 'Prices are net unless stated otherwise.',
    attributeSample: 'Example',
    sample: {
      headerNote: 'One delivery to the warehouse address. Please confirm by the end of the week.',
      channelName: 'B2B store',
      orderNumberLabel: 'Customer order number',
      siteLabel: 'Delivery site',
      siteValue: 'Main warehouse',
      packaging: 'Box of 100',
      lineNote: 'Cut to 0.5 m',
      groupFasteners: 'Fasteners',
      groupMounting: 'Mounting',
    },
  },
  'pl-PL': {
    fields: {
      productName: 'Produkt',
      variant: 'Wariant',
      sku: 'SKU',
      quantity: 'Ilość',
      packagingUnit: 'Opakowanie',
      packagingQuantity: 'Ilość w opakowaniach',
      listUnitPrice: 'Cena katalogowa',
      proposedUnitPrice: 'Cena proponowana przez klienta',
      unitPrice: 'Cena po rabacie',
      unitGrossPrice: 'Cena jedn. brutto',
      discountPercent: 'Rabat %',
      unitDiscount: 'Rabat na sztuce',
      lineDiscount: 'Rabat pozycji',
      lineListValue: 'Wartość wg cennika',
      lineNet: 'Wartość netto',
      vatRate: 'Stawka VAT',
      lineVat: 'VAT',
      lineGross: 'Wartość brutto',
      lineNote: 'Uwagi do pozycji',
      productUrl: 'Adres strony produktu',
    },
    groups: { line: 'Pozycja', pricing: 'Ceny', product: 'Atrybuty produktu' },
    totals: {
      listTotal: 'Razem wg cennika',
      discountTotal: 'Rabaty',
      netTotal: 'Razem netto',
      vatRate: 'Stawka VAT',
      vatTotal: 'VAT',
      grossTotal: 'Razem brutto',
    },
    status: {
      'Created from admin': 'Utworzone przez dział sprzedaży',
      Pending: 'Oczekujące',
      Approved: 'Zatwierdzone',
      Canceled: 'Anulowane',
      Completed: 'Zrealizowane',
      Expired: 'Wygasłe',
    },
    header: {
      title: 'Oferta',
      number: 'Numer oferty:',
      issueDate: 'Data:',
      validUntil: 'Ważna do:',
      revision: 'Wersja:',
    },
    parties: { buyer: 'Nabywca', taxId: 'NIP:', customer: 'Osoba kontaktowa', salesRep: 'Twój opiekun handlowy' },
    notes: 'Uwagi',
    details: 'Szczegóły',
    emptyLines: 'Ta oferta nie ma pozycji.',
    netPricesNote: 'Ceny netto, o ile nie zaznaczono inaczej.',
    attributeSample: 'Przykład',
    sample: {
      headerNote: 'Dostawa jednorazowa na adres magazynu. Prosimy o potwierdzenie do końca tygodnia.',
      channelName: 'Sklep B2B',
      orderNumberLabel: 'Numer zamówienia klienta',
      siteLabel: 'Miejsce dostawy',
      siteValue: 'Magazyn główny',
      packaging: 'Karton 100 szt.',
      lineNote: 'Cięte na 0,5 m',
      groupFasteners: 'Elementy złączne',
      groupMounting: 'Montaż',
    },
  },
};

/** The texts of a language: exact, else the same primary language, else English. */
export function quoteDocumentTexts(language: string): QuoteDocumentTexts {
  if (language === 'pl-PL' || language.split('-')[0]?.toLowerCase() === 'pl') return QUOTE_DOCUMENT_TEXTS['pl-PL'];
  return QUOTE_DOCUMENT_TEXTS['en-US'];
}

/**
 * A per-locale label (an attribute's, a custom field's): exact language, then
 * one with the same primary subtag, then English, then the fallback.
 */
export function localized(labels: Readonly<Record<string, string>> | undefined, language: string, fallback: string): string {
  if (!labels) return fallback;
  const exact = labels[language];
  if (exact) return exact;
  const primary = language.split('-')[0]?.toLowerCase();
  const sameBase = Object.keys(labels).find((key) => key.split('-')[0]?.toLowerCase() === primary && labels[key]);
  if (sameBase) return labels[sameBase]!;
  return labels['en-US'] || labels['en'] || fallback;
}
