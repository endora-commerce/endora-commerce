import type { Content, TableCell } from 'pdfmake/interfaces.js';
import type { InvoiceDetail } from '@b2b/contracts';
import { amountToWords, type AmountToWordsLocale } from '../services/amount-to-words.js';

/**
 * Invoice PDF section builders (feature 047, US6). Each maps a slice of the
 * invoice data (+ optional Puck props) to pdfmake `Content`. Shared by the
 * built-in generic layout and the WYSIWYG template tree mapper.
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

type Align = 'left' | 'center' | 'right';
type Props = Record<string, unknown>;

function num(p: Props, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function bool(p: Props, key: string, fallback: boolean): boolean {
  const v = p[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}
function str(p: Props, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' && v.trim() ? v : fallback;
}
function optStr(p: Props, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}
function alignOf(p: Props, fallback: Align = 'left'): Align {
  const v = p['align'];
  return v === 'center' || v === 'right' || v === 'left' ? v : fallback;
}
function marginBox(
  p: Props,
  defaultTop: number,
  defaultBottom: number,
): [number, number, number, number] {
  return [0, num(p, 'marginTop', defaultTop), 0, num(p, 'marginBottom', defaultBottom)];
}

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

export function headerSection(inv: InvoiceDetail, props: Props = {}): Content {
  const titleSize = num(props, 'titleSize', 14);
  const titleColor = optStr(props, 'titleColor');
  const titleBold = bool(props, 'titleBold', true);
  const align = alignOf(props, 'left');
  const rows: TableCell[][] = [
    [
      {
        text: `${TITLES[inv.kind]} nr ${inv.number}`,
        bold: titleBold,
        fontSize: titleSize,
        color: titleColor,
        alignment: align,
      },
    ],
  ];
  if (bool(props, 'showIssuedAt', true)) {
    rows.push([
      {
        text: `${str(props, 'labelIssuedAt', 'Data wystawienia')}: ${inv.issuedAt.slice(0, 10)}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showSaleDate', true)) {
    rows.push([
      {
        text: `${str(props, 'labelSaleDate', 'Data sprzedaży')}: ${inv.saleDate ?? inv.issuedAt.slice(0, 10)}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showPaymentDue', true)) {
    rows.push([
      {
        text: `${str(props, 'labelPaymentDue', 'Termin płatności')}: ${inv.paymentDueDate ?? '-'}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showPaymentMethod', true)) {
    rows.push([
      {
        text: `${str(props, 'labelPaymentMethod', 'Metoda płatności')}: ${inv.paymentMethod ?? '-'}`,
        alignment: align,
      },
    ]);
  }
  return {
    table: { widths: ['*'], body: rows },
    layout: 'noBorders',
    margin: marginBox(props, 0, 12),
  };
}

export function partiesSection(inv: InvoiceDetail, props: Props = {}): Content {
  const seller = inv.seller;
  const buyer = inv.buyer;
  const labelFs = num(props, 'labelFontSize', 10);
  const bodyFs = num(props, 'bodyFontSize', 10);
  const sellerPct = Math.min(70, Math.max(30, num(props, 'sellerWidthPercent', 50)));
  const gap = num(props, 'columnGap', 16);
  const sellerStack: Content[] = [
    { text: str(props, 'sellerLabel', 'Sprzedawca'), bold: true, fontSize: labelFs, margin: [0, 0, 0, 2] },
    { text: seller.legalName, fontSize: bodyFs },
    { text: seller.addressLine1, fontSize: bodyFs },
  ];
  if (seller.addressLine2) sellerStack.push({ text: seller.addressLine2, fontSize: bodyFs });
  sellerStack.push({ text: `${seller.postalCode} ${seller.city}`, fontSize: bodyFs });
  sellerStack.push({ text: `NIP: ${seller.taxId}`, fontSize: bodyFs });
  if (bool(props, 'showSellerBank', true) && seller.bankAccount) {
    sellerStack.push({ text: `${seller.bankName ?? ''} ${seller.bankAccount}`.trim(), fontSize: bodyFs });
  }
  if (bool(props, 'showSellerSwift', true) && seller.swift) {
    sellerStack.push({ text: `SWIFT: ${seller.swift}`, fontSize: bodyFs });
  }

  const buyerStack: Content[] = [
    { text: str(props, 'buyerLabel', 'Nabywca'), bold: true, fontSize: labelFs, margin: [0, 0, 0, 2] },
    { text: buyer.name, fontSize: bodyFs },
  ];
  if (buyer.addressLine1) buyerStack.push({ text: buyer.addressLine1, fontSize: bodyFs });
  if (buyer.postalCode || buyer.city) {
    buyerStack.push({ text: `${buyer.postalCode} ${buyer.city}`.trim(), fontSize: bodyFs });
  }
  if (bool(props, 'showBuyerTaxId', true) && buyer.taxId) {
    buyerStack.push({ text: `NIP: ${buyer.taxId}`, fontSize: bodyFs });
  }

  return {
    columns: [
      { width: `${sellerPct}%`, stack: sellerStack },
      { width: gap, text: '' },
      { width: `${100 - sellerPct}%`, stack: buyerStack },
    ],
    margin: marginBox(props, 0, 16),
  };
}

export function lineItemsSection(inv: InvoiceDetail, props: Props = {}): Content {
  const fontSize = num(props, 'fontSize', 8);
  const headerBold = bool(props, 'headerBold', true);
  const headerBg = optStr(props, 'headerBackground');
  const headerColor = optStr(props, 'headerColor');
  const borderColor = optStr(props, 'borderColor') ?? '#cbd5e1';
  const zebra = bool(props, 'zebra', false);
  const showUnit = bool(props, 'showUnit', true);
  const showQty = bool(props, 'showQty', true);
  const showUnitNet = bool(props, 'showUnitNet', true);
  const showTaxRate = bool(props, 'showTaxRate', true);
  const showNet = bool(props, 'showNet', true);
  const showGross = bool(props, 'showGross', true);

  type Col = { key: string; label: string; width: number | '*'; right?: boolean };
  const cols: Col[] = [
    { key: 'lp', label: 'Lp', width: 16 },
    { key: 'name', label: 'Nazwa', width: '*' },
  ];
  if (showUnit) cols.push({ key: 'unit', label: 'Jedn.', width: 28 });
  if (showQty) cols.push({ key: 'qty', label: 'Ilość', width: 32, right: true });
  if (showUnitNet) cols.push({ key: 'unitNet', label: 'Cena netto', width: 50, right: true });
  if (showTaxRate) cols.push({ key: 'tax', label: 'Stawka', width: 32, right: true });
  if (showNet) cols.push({ key: 'net', label: 'Wartość netto', width: 56, right: true });
  if (showGross) cols.push({ key: 'gross', label: 'Wartość brutto', width: 56, right: true });

  const headerRow: TableCell[] = cols.map((c) => ({
    text: c.label,
    bold: headerBold,
    fontSize,
    color: headerColor,
    fillColor: headerBg,
    alignment: c.right ? ('right' as const) : ('left' as const),
  }));

  const body: TableCell[][] = [headerRow];
  inv.lines.forEach((l, i) => {
    const fill = zebra && i % 2 === 1 ? '#f8fafc' : undefined;
    const cell = (text: string, right?: boolean): TableCell => ({
      text,
      fontSize,
      fillColor: fill,
      alignment: right ? ('right' as const) : ('left' as const),
    });
    const row: TableCell[] = [];
    for (const c of cols) {
      switch (c.key) {
        case 'lp':
          row.push(cell(String(l.ordinal)));
          break;
        case 'name':
          row.push(cell(l.name));
          break;
        case 'unit':
          row.push(cell(l.unit));
          break;
        case 'qty':
          row.push(cell(String(l.quantity), true));
          break;
        case 'unitNet':
          row.push(cell(money(l.unitNetPrice), true));
          break;
        case 'tax':
          row.push(cell(pct(l.taxRate), true));
          break;
        case 'net':
          row.push(cell(money(l.netValue), true));
          break;
        case 'gross':
          row.push(cell(money(l.grossValue), true));
          break;
        default:
          break;
      }
    }
    body.push(row);
  });

  return {
    table: {
      headerRows: 1,
      widths: cols.map((c) => c.width),
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => borderColor,
      vLineColor: () => borderColor,
    },
    margin: marginBox(props, 0, 12),
  };
}

export function vatSummarySection(inv: InvoiceDetail, props: Props = {}): Content {
  const fontSize = num(props, 'fontSize', 8);
  const headerBold = bool(props, 'headerBold', true);
  const headerBg = optStr(props, 'headerBackground');
  const headerColor = optStr(props, 'headerColor');
  const borderColor = optStr(props, 'borderColor') ?? '#cbd5e1';
  const showTotalRow = bool(props, 'showTotalRow', true);
  const totalLabel = str(props, 'totalLabel', 'Razem');

  const header: TableCell[] = ['Stawka VAT', 'Wartość netto', 'Kwota VAT', 'Wartość brutto'].map(
    (t, i) => ({
      text: t,
      bold: headerBold,
      fontSize,
      color: headerColor,
      fillColor: headerBg,
      alignment: i === 0 ? ('left' as const) : ('right' as const),
    }),
  );
  const rows: TableCell[][] = [header];
  for (const v of inv.vatSummary) {
    rows.push([
      { text: pct(v.taxRate), fontSize },
      { text: money(v.netTotal), fontSize, alignment: 'right' },
      { text: money(v.vatAmount), fontSize, alignment: 'right' },
      { text: money(v.grossTotal), fontSize, alignment: 'right' },
    ]);
  }
  if (showTotalRow) {
    rows.push([
      { text: totalLabel, fontSize, bold: true },
      { text: money(inv.netTotal), fontSize, alignment: 'right', bold: true },
      { text: money(inv.taxTotal), fontSize, alignment: 'right', bold: true },
      { text: money(inv.grossTotal), fontSize, alignment: 'right', bold: true },
    ]);
  }
  return {
    table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: rows },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => borderColor,
      vLineColor: () => borderColor,
    },
    margin: marginBox(props, 0, 12),
  };
}

export function totalsSection(
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
  props: Props = {},
): Content {
  const align = alignOf(props, 'right');
  const fontSize = num(props, 'fontSize', 10);
  const color = optStr(props, 'color');
  const amountDueColor = optStr(props, 'amountDueColor') ?? color;
  const stack: Content[] = [];
  if (bool(props, 'showPaid', true)) {
    stack.push({
      text: `${str(props, 'labelPaid', 'Zapłacono')}: ${money(inv.paidTotal)} ${inv.currency}`,
      alignment: align,
      fontSize,
      color,
    });
  }
  if (bool(props, 'showAmountDue', true)) {
    stack.push({
      text: `${str(props, 'labelAmountDue', 'Do zapłaty')}: ${money(inv.amountDue)} ${inv.currency}`,
      alignment: align,
      bold: bool(props, 'amountDueBold', true),
      fontSize,
      color: amountDueColor,
    });
  }
  if (bool(props, 'showGross', true)) {
    stack.push({
      text: `${str(props, 'labelGross', 'Razem')}: ${money(inv.grossTotal)} ${inv.currency}`,
      alignment: align,
      fontSize,
      color,
    });
  }
  if (bool(props, 'showAmountInWords', true)) {
    stack.push({
      text: `${str(props, 'labelInWords', 'Słownie')}: ${amountToWords(inv.grossTotal, inv.currency, locale)}`,
      alignment: align,
      italics: bool(props, 'amountInWordsItalics', true),
      fontSize,
      color,
      margin: [0, 6, 0, 0],
    });
  }
  return { stack, margin: marginBox(props, 0, 16) };
}

function textBlock(
  raw: string,
  inv: InvoiceDetail,
  props: Props,
  defaults: { fontSize: number; showTopDivider: boolean; marginBottom: number },
): Content {
  const align = alignOf(props, 'left');
  const fontSize = num(props, 'fontSize', defaults.fontSize);
  const color = optStr(props, 'color');
  const textNode: Content = {
    text: interpolate(raw, inv),
    alignment: align,
    fontSize,
    color,
    bold: bool(props, 'bold', false),
    italics: bool(props, 'italics', false),
  };
  const stack: Content[] = [];
  if (bool(props, 'showTopDivider', defaults.showTopDivider)) {
    stack.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
      margin: [0, 0, 0, 8],
    });
  }
  stack.push(textNode);
  return { stack, margin: marginBox(props, num(props, 'marginTop', 0), defaults.marginBottom) };
}

export function notesSection(props: Props, inv: InvoiceDetail): Content {
  const raw = typeof props['text'] === 'string' ? (props['text'] as string) : '';
  return textBlock(raw, inv, props, { fontSize: 11, showTopDivider: false, marginBottom: 8 });
}

export function footerSection(props: Props, inv: InvoiceDetail): Content {
  const raw =
    typeof props['text'] === 'string'
      ? (props['text'] as string)
      : 'Dziękujemy za współpracę.\n{{var seller.legalName}} · NIP {{var seller.taxId}}';
  return textBlock(raw, inv, props, { fontSize: 9, showTopDivider: true, marginBottom: 8 });
}

export function ksefSection(inv: InvoiceDetail, props: Props = {}): Content {
  if (!inv.ksefReferenceNumber) {
    if (bool(props, 'hideWhenEmpty', true)) return { text: '' };
    return { text: '', margin: marginBox(props, 8, 0) };
  }
  const fontSize = num(props, 'fontSize', 8);
  const color = optStr(props, 'color');
  const stack: Content[] = [
    {
      text: `${str(props, 'labelNumber', 'Numer w KSeF')}: ${inv.ksefReferenceNumber}`,
      fontSize,
      color,
    },
  ];
  if (bool(props, 'showProcessedAt', true) && inv.ksefProcessedAt) {
    stack.push({
      text: `${str(props, 'labelProcessedAt', 'Data przetworzenia w KSeF')}: ${inv.ksefProcessedAt.slice(0, 19).replace('T', ' ')}`,
      fontSize,
      color,
    });
  }
  return { stack, margin: marginBox(props, 8, 0) };
}

export function spacerSection(props: Props = {}): Content {
  const height = Math.min(120, Math.max(4, num(props, 'height', 16)));
  const bg = optStr(props, 'backgroundColor');
  if (bg) {
    return {
      canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: height, color: bg }],
      margin: [0, 0, 0, 0],
    };
  }
  return { text: '', margin: [0, 0, 0, height] };
}

export function dividerSection(props: Props = {}): Content {
  const thickness = Math.min(8, Math.max(1, num(props, 'thickness', 1)));
  const color = optStr(props, 'color') ?? '#e5e7eb';
  const widthPercent = Math.min(100, Math.max(10, num(props, 'widthPercent', 100)));
  const align = alignOf(props, 'left');
  const full = 515;
  const w = Math.round((full * widthPercent) / 100);
  let x1 = 0;
  if (align === 'center') x1 = Math.round((full - w) / 2);
  if (align === 'right') x1 = full - w;
  const dashed = props['style'] === 'dashed';
  const marginY = num(props, 'marginY', 8);
  return {
    canvas: [
      {
        type: 'line',
        x1,
        y1: 0,
        x2: x1 + w,
        y2: 0,
        lineWidth: thickness,
        lineColor: color,
        ...(dashed ? { dash: { length: 4 } } : {}),
      },
    ],
    margin: [0, marginY, 0, marginY],
  };
}

export function logoSection(props: Props = {}): Content {
  const src = optStr(props, 'src');
  // Absolute http(s) is legacy; preferred path is a data URI embedded by
  // `embedInvoiceLogoImages` before render (avoids pdfmake self-HTTP).
  if (!src || !/^(https?:\/\/|data:image\/)/i.test(src)) return { text: '' };
  const width = num(props, 'width', 140);
  const maxHeight = num(props, 'maxHeight', 80);
  const align = alignOf(props, 'center');
  const marginBottom = num(props, 'marginBottom', 12);
  return {
    image: src,
    width,
    height: maxHeight,
    fit: [width, maxHeight],
    alignment: align,
    margin: [0, 0, 0, marginBottom],
  };
}
