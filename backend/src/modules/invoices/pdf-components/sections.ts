import type { Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@b2b/contracts';
import { amountToWords, type AmountToWordsLocale } from '../services/amount-to-words.js';

/**
 * Invoice PDF section builders (feature 047, US6). Each maps a slice of the
 * invoice data to pdfmake `Content`. Shared by the built-in generic layout
 * (the FR-016 fallback) and the WYSIWYG template tree mapper, so both render
 * identically component-for-component.
 */

export function money(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export const TITLES: Record<InvoiceDetail['kind'], string> = {
  invoice: 'Faktura',
  proforma: 'Faktura proforma',
  correction: 'Faktura korygująca',
};

/** Interpolate `{{var invoice.x}}` / `{{var order.x}}` style tokens. */
export function interpolate(text: string, inv: InvoiceDetail): string {
  const map: Record<string, string> = {
    'invoice.number': inv.number,
    'invoice.total': money(inv.grossTotal),
    'invoice.currency': inv.currency,
    'invoice.issuedAt': inv.issuedAt.slice(0, 10),
    'invoice.saleDate': inv.saleDate ?? inv.issuedAt.slice(0, 10),
    'invoice.amountDue': money(inv.amountDue),
    'buyer.name': inv.buyer.name,
    'seller.legalName': inv.seller.legalName,
    'seller.taxId': inv.seller.taxId ?? '',
  };
  return text.replace(/\{\{\s*var\s+([\w.]+)\s*\}\}/g, (_m, key: string) => map[key] ?? '');
}

export function headerSection(inv: InvoiceDetail): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [{ text: `${TITLES[inv.kind]} nr ${inv.number}`, style: 'docTitle' }],
        [{ text: `Data wystawienia: ${inv.issuedAt.slice(0, 10)}` }],
        [{ text: `Data sprzedaży: ${inv.saleDate ?? inv.issuedAt.slice(0, 10)}` }],
        [{ text: `Termin płatności: ${inv.paymentDueDate ?? '-'}` }],
        [{ text: `Metoda płatności: ${inv.paymentMethod ?? '-'}` }],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 12],
  };
}

export function partiesSection(inv: InvoiceDetail): Content {
  const seller = inv.seller;
  const buyer = inv.buyer;
  return {
    columns: [
      {
        width: '50%',
        stack: [
          { text: 'Sprzedawca', bold: true, margin: [0, 0, 0, 2] },
          { text: seller.legalName },
          { text: seller.addressLine1 },
          ...(seller.addressLine2 ? [{ text: seller.addressLine2 }] : []),
          { text: `${seller.postalCode} ${seller.city}` },
          { text: `NIP: ${seller.taxId}` },
          ...(seller.bankAccount ? [{ text: `${seller.bankName ?? ''} ${seller.bankAccount}` }] : []),
          ...(seller.swift ? [{ text: `SWIFT: ${seller.swift}` }] : []),
        ],
      },
      {
        width: '50%',
        stack: [
          { text: 'Nabywca', bold: true, margin: [0, 0, 0, 2] },
          { text: buyer.name },
          ...(buyer.addressLine1 ? [{ text: buyer.addressLine1 }] : []),
          ...(buyer.postalCode || buyer.city ? [{ text: `${buyer.postalCode} ${buyer.city}` }] : []),
          ...(buyer.taxId ? [{ text: `NIP: ${buyer.taxId}` }] : []),
        ],
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

export function lineItemsSection(inv: InvoiceDetail): Content {
  const header = ['Lp', 'Nazwa', 'Jedn.', 'Ilość', 'Cena netto', 'Stawka', 'Wartość netto', 'Wartość brutto'].map(
    (t) => ({ text: t, bold: true, fontSize: 8 }),
  );
  const rows = inv.lines.map((l) => [
    { text: String(l.ordinal), fontSize: 8 },
    { text: l.name, fontSize: 8 },
    { text: l.unit, fontSize: 8 },
    { text: String(l.quantity), fontSize: 8, alignment: 'right' as const },
    { text: money(l.unitNetPrice), fontSize: 8, alignment: 'right' as const },
    { text: pct(l.taxRate), fontSize: 8, alignment: 'right' as const },
    { text: money(l.netValue), fontSize: 8, alignment: 'right' as const },
    { text: money(l.grossValue), fontSize: 8, alignment: 'right' as const },
  ]);
  return {
    table: { headerRows: 1, widths: [16, '*', 28, 32, 50, 32, 56, 56], body: [header, ...rows] },
    margin: [0, 0, 0, 12],
  };
}

export function vatSummarySection(inv: InvoiceDetail): Content {
  const header = ['Stawka VAT', 'Wartość netto', 'Kwota VAT', 'Wartość brutto'].map((t) => ({
    text: t,
    bold: true,
    fontSize: 8,
  }));
  const rows = inv.vatSummary.map((v) => [
    { text: pct(v.taxRate), fontSize: 8 },
    { text: money(v.netTotal), fontSize: 8, alignment: 'right' as const },
    { text: money(v.vatAmount), fontSize: 8, alignment: 'right' as const },
    { text: money(v.grossTotal), fontSize: 8, alignment: 'right' as const },
  ]);
  rows.push([
    { text: 'Razem', fontSize: 8 },
    { text: money(inv.netTotal), fontSize: 8, alignment: 'right' as const },
    { text: money(inv.taxTotal), fontSize: 8, alignment: 'right' as const },
    { text: money(inv.grossTotal), fontSize: 8, alignment: 'right' as const },
  ]);
  return {
    table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: [header, ...rows] },
    margin: [0, 0, 0, 12],
  };
}

export function totalsSection(inv: InvoiceDetail, locale: AmountToWordsLocale): Content {
  return {
    stack: [
      { text: `Zapłacono: ${money(inv.paidTotal)} ${inv.currency}`, alignment: 'right' },
      { text: `Do zapłaty: ${money(inv.amountDue)} ${inv.currency}`, alignment: 'right', bold: true },
      { text: `Razem: ${money(inv.grossTotal)} ${inv.currency}`, alignment: 'right' },
      {
        text: `Słownie: ${amountToWords(inv.grossTotal, inv.currency, locale)}`,
        alignment: 'right',
        italics: true,
        margin: [0, 6, 0, 0],
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

export function notesSection(props: { text?: string }, inv: InvoiceDetail): Content {
  const raw = typeof props.text === 'string' ? props.text : '';
  return { text: interpolate(raw, inv), margin: [0, 0, 0, 8] };
}

/**
 * KSeF verification data supplied by the ksef module (feature 059) through the
 * renderer's optional resolver — absent when the module is inactive, in which
 * case this section renders exactly the pre-059 number + date.
 */
export interface KsefVerificationData {
  /** KOD I verification URL rendered as a QR code. */
  verificationUrl: string;
  /** Issued during a KSeF outage — offline marking required (FR-017). */
  offline: boolean;
}

export type InvoiceDetailWithKsef = InvoiceDetail & { ksefVerification?: KsefVerificationData };

export function ksefSection(inv: InvoiceDetail): Content {
  const verification = (inv as InvoiceDetailWithKsef).ksefVerification;
  if (!inv.ksefReferenceNumber) {
    // Offline marking applies even before the KSeF number is assigned — a
    // document shared during an outage must say so (FR-017).
    if (verification?.offline) {
      return { text: 'Faktura wystawiona w trybie offline — oczekuje na przydzielenie numeru KSeF.', fontSize: 8, margin: [0, 8, 0, 0] };
    }
    return { text: '' };
  }
  return {
    stack: [
      { text: `Numer w KSeF: ${inv.ksefReferenceNumber}`, fontSize: 8 },
      ...(inv.ksefProcessedAt
        ? [{ text: `Data przetworzenia w KSeF: ${inv.ksefProcessedAt.slice(0, 19).replace('T', ' ')}`, fontSize: 8 }]
        : []),
      ...(verification?.offline
        ? [{ text: 'Faktura wystawiona w trybie offline.', fontSize: 8 }]
        : []),
      ...(verification && verification.verificationUrl
        ? [
            {
              qr: verification.verificationUrl,
              fit: 90,
              margin: [0, 6, 0, 2] as [number, number, number, number],
            },
            { text: 'Zweryfikuj fakturę w KSeF', fontSize: 7 },
          ]
        : []),
    ],
    margin: [0, 8, 0, 0],
  };
}
