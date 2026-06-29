import path from 'node:path';
import { createRequire } from 'node:module';
import type { TDocumentDefinitions, TFontDictionary, Content } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@b2b/contracts';
import { amountToWords, type AmountToWordsLocale } from './amount-to-words.js';

interface PdfMakeOutput {
  getBuffer(): Promise<Buffer>;
}
interface PdfMakeSingleton {
  setFonts(fonts: TFontDictionary): void;
  setUrlAccessPolicy(policy: ((url: string) => boolean) | undefined): void;
  createPdf(def: TDocumentDefinitions): PdfMakeOutput;
}
const requireFromHere = createRequire(import.meta.url);
const pdfMake = requireFromHere('pdfmake') as PdfMakeSingleton;

function buildFontDictionary(): TFontDictionary {
  const fontsDir = requireFromHere
    .resolve('pdfmake/package.json')
    .replace(/package\.json$/, `fonts${path.sep}Roboto${path.sep}`);
  return {
    Roboto: {
      normal: `${fontsDir}Roboto-Regular.ttf`,
      bold: `${fontsDir}Roboto-Medium.ttf`,
      italics: `${fontsDir}Roboto-Italic.ttf`,
      bolditalics: `${fontsDir}Roboto-MediumItalic.ttf`,
    },
  };
}

let fontsRegistered = false;

function money(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const TITLES: Record<InvoiceDetail['kind'], string> = {
  invoice: 'Faktura',
  proforma: 'Faktura proforma',
  correction: 'Faktura korygująca',
};

/**
 * Renders an invoice to a PDF Buffer using pdfmake (feature 047, R1).
 *
 * For now this produces the built-in generic layout (modeled on the reference
 * document) directly from the invoice data. A WYSIWYG (Puck) template, when
 * present, layers on in a later phase (US6); the built-in layout is the
 * guaranteed fallback (FR-016).
 */
export class InvoicePdfRenderer {
  render(invoice: InvoiceDetail, locale: AmountToWordsLocale = 'pl'): Promise<Buffer> {
    if (!fontsRegistered) {
      pdfMake.setFonts(buildFontDictionary());
      pdfMake.setUrlAccessPolicy(() => false);
      fontsRegistered = true;
    }
    return pdfMake.createPdf(this.buildDoc(invoice, locale)).getBuffer();
  }

  private buildDoc(inv: InvoiceDetail, locale: AmountToWordsLocale): TDocumentDefinitions {
    const seller = inv.seller;
    const buyer = inv.buyer;

    const headerBox: Content = {
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

    const parties: Content = {
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

    const lineHeader = ['Lp', 'Nazwa', 'Jedn.', 'Ilość', 'Cena netto', 'Stawka', 'Wartość netto', 'Wartość brutto'].map(
      (t) => ({ text: t, bold: true, fontSize: 8 }),
    );
    const lineRows = inv.lines.map((l) => [
      { text: String(l.ordinal), fontSize: 8 },
      { text: l.name, fontSize: 8 },
      { text: l.unit, fontSize: 8 },
      { text: String(l.quantity), fontSize: 8, alignment: 'right' as const },
      { text: money(l.unitNetPrice), fontSize: 8, alignment: 'right' as const },
      { text: pct(l.taxRate), fontSize: 8, alignment: 'right' as const },
      { text: money(l.netValue), fontSize: 8, alignment: 'right' as const },
      { text: money(l.grossValue), fontSize: 8, alignment: 'right' as const },
    ]);

    const linesTable: Content = {
      table: { headerRows: 1, widths: [16, '*', 28, 32, 50, 32, 56, 56], body: [lineHeader, ...lineRows] },
      margin: [0, 0, 0, 12],
    };

    const vatHeader = ['Stawka VAT', 'Wartość netto', 'Kwota VAT', 'Wartość brutto'].map((t) => ({
      text: t,
      bold: true,
      fontSize: 8,
    }));
    const vatRows = inv.vatSummary.map((v) => [
      { text: pct(v.taxRate), fontSize: 8 },
      { text: money(v.netTotal), fontSize: 8, alignment: 'right' as const },
      { text: money(v.vatAmount), fontSize: 8, alignment: 'right' as const },
      { text: money(v.grossTotal), fontSize: 8, alignment: 'right' as const },
    ]);
    vatRows.push([
      { text: 'Razem', fontSize: 8 },
      { text: money(inv.netTotal), fontSize: 8, alignment: 'right' as const },
      { text: money(inv.taxTotal), fontSize: 8, alignment: 'right' as const },
      { text: money(inv.grossTotal), fontSize: 8, alignment: 'right' as const },
    ]);

    const summary: Content = {
      columns: [
        { width: '55%', table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: [vatHeader, ...vatRows] } },
        {
          width: '45%',
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
        },
      ],
      margin: [0, 0, 0, 24],
    };

    const footer: Content[] = [];
    if (inv.kind === 'correction' && inv.originalInvoiceId) {
      footer.push({ text: 'Dokument korygujący do faktury pierwotnej.', italics: true, margin: [0, 0, 0, 8] });
    }
    if (inv.ksefReferenceNumber) {
      footer.push({ text: `Numer w KSeF: ${inv.ksefReferenceNumber}`, fontSize: 8 });
    }

    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 48],
      defaultStyle: { fontSize: 10, font: 'Roboto' },
      styles: { docTitle: { fontSize: 14, bold: true } },
      content: [headerBox, parties, linesTable, summary, ...footer],
    };
  }
}
