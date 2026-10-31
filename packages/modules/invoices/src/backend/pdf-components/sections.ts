import type { Content, TableCell } from 'pdfmake/interfaces.js';
import { unitPriceFractionDigits, type InvoiceDetail } from '@endora-commerce/contracts';
import { amountToWords, type AmountToWordsLocale } from '../services/amount-to-words.js';
import { fillPlaceholders, INVOICES_PROSE_EN, type InvoicesProseKey } from '../invoices-prose.js';

/**
 * Invoice PDF section builders (feature 047, US6). Each maps a slice of the
 * invoice data (+ optional Puck props) to pdfmake `Content`. Shared by the
 * built-in generic layout and the WYSIWYG template tree mapper.
 */

export function money(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/**
 * A unit price — the unit net price column: its significant places, up to
 * four, at least two (owner ruling of 2026-10-25; `unitPriceFractionDigits`).
 * Line values and totals are {@link money}, two places.
 */
export function unitMoney(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: unitPriceFractionDigits(n) });
}
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Every label the PDF draws that a template prop does not supply, keyed by its
 * key in this module's bundle. The renderer resolves them in the document's
 * `language` before drawing (`document/invoice-document-type.ts`); a section
 * built without them draws English.
 */
export const INVOICE_PDF_LABEL_KEYS = (Object.keys(INVOICES_PROSE_EN) as InvoicesProseKey[]).filter(
  (key): key is Extract<InvoicesProseKey, `pdf.${string}`> => key.startsWith('pdf.'),
);
export type InvoicePdfLabelKey = (typeof INVOICE_PDF_LABEL_KEYS)[number];
export type InvoicePdfLabels = Readonly<Record<InvoicePdfLabelKey, string>>;
export const INVOICE_PDF_LABELS_EN: InvoicePdfLabels = Object.fromEntries(
  INVOICE_PDF_LABEL_KEYS.map((key) => [key, INVOICES_PROSE_EN[key]]),
) as InvoicePdfLabels;

const TITLE_KEYS: Record<InvoiceDetail['kind'], InvoicePdfLabelKey> = {
  invoice: 'pdf.title.invoice',
  proforma: 'pdf.title.proforma',
  correction: 'pdf.title.correction',
  wz: 'pdf.title.wz',
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
    'invoice.overpayment': money(inv.overpayment),
    'buyer.name': inv.buyer.name,
    'seller.legalName': inv.seller.legalName,
    'seller.taxId': inv.seller.taxId ?? '',
  };
  return text.replace(/\{\{\s*var\s+([\w.]+)\s*\}\}/g, (_m, key: string) => map[key] ?? '');
}

/** What the renderer tells the header beyond its props. */
export interface HeaderSectionOptions {
  /**
   * A present, placed contributed block prints the KSeF number itself, so the
   * header's own row stands down (`specs/134-paid-module-extraction/` T137).
   */
  readonly suppressKsefNumber?: boolean;
  /** The labels in the document's language. Absent, English. */
  readonly labels?: InvoicePdfLabels;
}

export function headerSection(
  inv: InvoiceDetail,
  props: Props = {},
  options: HeaderSectionOptions = {},
): Content {
  const labels = options.labels ?? INVOICE_PDF_LABELS_EN;
  const titleSize = num(props, 'titleSize', 14);
  const titleColor = optStr(props, 'titleColor');
  const titleBold = bool(props, 'titleBold', true);
  const align = alignOf(props, 'left');
  const rows: TableCell[][] = [
    [
      {
        text: fillPlaceholders(labels['pdf.title.numbered'], {
          title: labels[TITLE_KEYS[inv.kind]],
          number: inv.number,
        }),
        bold: titleBold,
        fontSize: titleSize,
        color: titleColor,
        alignment: align,
      },
    ],
  ];
  // The invoice's KSeF number — `invoices`' own statutory data, whichever path
  // recorded it (T137, D22 §3(a)). A label prop and deliberately **no**
  // show/hide prop: an operator may not switch off a statutory identifier that
  // a module toggle would otherwise remove.
  if (inv.ksefReferenceNumber && !options.suppressKsefNumber) {
    rows.push([
      {
        text: `${str(props, 'labelKsefNumber', labels['pdf.label.ksefNumber'])}: ${inv.ksefReferenceNumber}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showIssuedAt', true)) {
    rows.push([
      {
        text: `${str(props, 'labelIssuedAt', labels['pdf.label.issuedAt'])}: ${inv.issuedAt.slice(0, 10)}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showSaleDate', true)) {
    rows.push([
      {
        text: `${str(props, 'labelSaleDate', labels['pdf.label.saleDate'])}: ${inv.saleDate ?? inv.issuedAt.slice(0, 10)}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showPaymentDue', true)) {
    rows.push([
      {
        text: `${str(props, 'labelPaymentDue', labels['pdf.label.paymentDue'])}: ${inv.paymentDueDate ?? '-'}`,
        alignment: align,
      },
    ]);
  }
  if (bool(props, 'showPaymentMethod', true)) {
    rows.push([
      {
        text: `${str(props, 'labelPaymentMethod', labels['pdf.label.paymentMethod'])}: ${inv.paymentMethod ?? '-'}`,
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

export function partiesSection(
  inv: InvoiceDetail,
  props: Props = {},
  labels: InvoicePdfLabels = INVOICE_PDF_LABELS_EN,
): Content {
  const seller = inv.seller;
  const buyer = inv.buyer;
  const labelFs = num(props, 'labelFontSize', 10);
  const bodyFs = num(props, 'bodyFontSize', 10);
  const sellerPct = Math.min(70, Math.max(30, num(props, 'sellerWidthPercent', 50)));
  const gap = num(props, 'columnGap', 16);
  const sellerStack: Content[] = [
    { text: str(props, 'sellerLabel', labels['pdf.label.seller']), bold: true, fontSize: labelFs, margin: [0, 0, 0, 2] },
    { text: seller.legalName, fontSize: bodyFs },
    { text: seller.addressLine1, fontSize: bodyFs },
  ];
  if (seller.addressLine2) sellerStack.push({ text: seller.addressLine2, fontSize: bodyFs });
  sellerStack.push({ text: `${seller.postalCode} ${seller.city}`, fontSize: bodyFs });
  sellerStack.push({ text: `${labels['pdf.label.taxId']}: ${seller.taxId}`, fontSize: bodyFs });
  if (bool(props, 'showSellerBank', true) && seller.bankAccount) {
    sellerStack.push({ text: `${seller.bankName ?? ''} ${seller.bankAccount}`.trim(), fontSize: bodyFs });
  }
  if (bool(props, 'showSellerSwift', true) && seller.swift) {
    sellerStack.push({ text: `SWIFT: ${seller.swift}`, fontSize: bodyFs });
  }

  const buyerStack: Content[] = [
    { text: str(props, 'buyerLabel', labels['pdf.label.buyer']), bold: true, fontSize: labelFs, margin: [0, 0, 0, 2] },
    { text: buyer.name, fontSize: bodyFs },
  ];
  if (buyer.addressLine1) buyerStack.push({ text: buyer.addressLine1, fontSize: bodyFs });
  if (buyer.postalCode || buyer.city) {
    buyerStack.push({ text: `${buyer.postalCode} ${buyer.city}`.trim(), fontSize: bodyFs });
  }
  if (bool(props, 'showBuyerTaxId', true) && buyer.taxId) {
    buyerStack.push({ text: `${labels['pdf.label.taxId']}: ${buyer.taxId}`, fontSize: bodyFs });
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

export function lineItemsSection(
  inv: InvoiceDetail,
  props: Props = {},
  labels: InvoicePdfLabels = INVOICE_PDF_LABELS_EN,
): Content {
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
    { key: 'lp', label: labels['pdf.column.ordinal'], width: 16 },
    { key: 'name', label: labels['pdf.column.name'], width: '*' },
  ];
  if (showUnit) cols.push({ key: 'unit', label: labels['pdf.column.unit'], width: 28 });
  if (showQty) cols.push({ key: 'qty', label: labels['pdf.column.quantity'], width: 32, right: true });
  if (showUnitNet) cols.push({ key: 'unitNet', label: labels['pdf.column.unitNet'], width: 50, right: true });
  if (showTaxRate) cols.push({ key: 'tax', label: labels['pdf.column.taxRate'], width: 32, right: true });
  if (showNet) cols.push({ key: 'net', label: labels['pdf.column.net'], width: 56, right: true });
  if (showGross) cols.push({ key: 'gross', label: labels['pdf.column.gross'], width: 56, right: true });

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
          row.push(cell(unitMoney(l.unitNetPrice), true));
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

export function vatSummarySection(
  inv: InvoiceDetail,
  props: Props = {},
  labels: InvoicePdfLabels = INVOICE_PDF_LABELS_EN,
): Content {
  const fontSize = num(props, 'fontSize', 8);
  const headerBold = bool(props, 'headerBold', true);
  const headerBg = optStr(props, 'headerBackground');
  const headerColor = optStr(props, 'headerColor');
  const borderColor = optStr(props, 'borderColor') ?? '#cbd5e1';
  const showTotalRow = bool(props, 'showTotalRow', true);
  const totalLabel = str(props, 'totalLabel', labels['pdf.label.total']);

  const header: TableCell[] = [
    labels['pdf.vat.rate'],
    labels['pdf.column.net'],
    labels['pdf.vat.amount'],
    labels['pdf.column.gross'],
  ].map(
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

/**
 * `locale` is the language the amount in words is written in; `labels` the
 * language of the labels, the document's. The overpayment row (issue #428) is
 * labelled from `labels` unless a template's `labelOverpayment` replaces it.
 */
export function totalsSection(
  inv: InvoiceDetail,
  locale: AmountToWordsLocale,
  props: Props = {},
  labels: InvoicePdfLabels = INVOICE_PDF_LABELS_EN,
): Content {
  const align = alignOf(props, 'right');
  const fontSize = num(props, 'fontSize', 10);
  const color = optStr(props, 'color');
  const amountDueColor = optStr(props, 'amountDueColor') ?? color;
  const stack: Content[] = [];
  if (bool(props, 'showPaid', true)) {
    stack.push({
      text: `${str(props, 'labelPaid', labels['pdf.label.paid'])}: ${money(inv.paidTotal)} ${inv.currency}`,
      alignment: align,
      fontSize,
      color,
    });
  }
  if (bool(props, 'showAmountDue', true)) {
    stack.push({
      text: `${str(props, 'labelAmountDue', labels['pdf.label.amountDue'])}: ${money(inv.amountDue)} ${inv.currency}`,
      alignment: align,
      bold: bool(props, 'amountDueBold', true),
      fontSize,
      color: amountDueColor,
    });
  }
  // Issue #428 — what was paid above the gross, beside an amount due of 0.
  if (bool(props, 'showOverpayment', true) && inv.overpayment > 0) {
    stack.push({
      text: `${str(props, 'labelOverpayment', labels['pdf.label.overpayment'])}: ${money(inv.overpayment)} ${inv.currency}`,
      alignment: align,
      fontSize,
      color,
    });
  }
  if (bool(props, 'showGross', true)) {
    stack.push({
      text: `${str(props, 'labelGross', labels['pdf.label.total'])}: ${money(inv.grossTotal)} ${inv.currency}`,
      alignment: align,
      fontSize,
      color,
    });
  }
  if (bool(props, 'showAmountInWords', true)) {
    stack.push({
      text: `${str(props, 'labelInWords', labels['pdf.label.inWords'])}: ${amountToWords(inv.grossTotal, inv.currency, locale)}`,
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

export function footerSection(
  props: Props,
  inv: InvoiceDetail,
  labels: InvoicePdfLabels = INVOICE_PDF_LABELS_EN,
): Content {
  const raw =
    typeof props['text'] === 'string' ? (props['text'] as string) : labels['pdf.footer.default'];
  return textBlock(raw, inv, props, { fontSize: 9, showTopDivider: true, marginBottom: 8 });
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
