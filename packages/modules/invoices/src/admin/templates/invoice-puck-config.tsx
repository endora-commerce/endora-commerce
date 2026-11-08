import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Config, ComponentConfig } from '@puckeditor/core';
import { createColorField, definePageBuilderComponent } from '@endora-commerce/page-builder-core';
import { useBlockRenderEnvironment } from '@endora-commerce/page-builder-core/contributions';
import {
  createImageAssetField,
  createImageSourceField,
  createImageUrlField,
} from '@endora-commerce/page-builder-admin';
import { fetchAssetDetail } from '@endora-commerce/admin-kit/components';
import { getBundles, resolve, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { supportedLanguageOf, unitPriceFractionDigits } from '@endora-commerce/contracts';

/**
 * Dedicated Puck config for invoice PDF templates (feature 047, US6). Kept in
 * the admin module (not the shared cms-components package) because invoice
 * authoring is admin-only. The real PDF is produced server-side by pdfmake
 * (`backend/.../pdf-components/sections.ts`); these on-canvas renderers mirror
 * those section layouts against a representative sample invoice so the author
 * sees the actual content of each dropped block instead of a placeholder.
 * Component names + fields MUST match the backend tree mapper / descriptor.
 */

/**
 * Representative sample invoice — a frontend mirror of the backend
 * `sampleInvoiceDetail()` used by the `/preview` endpoint, so the on-canvas
 * content matches the rendered PDF.
 */
const sampleInvoice = {
  kind: 'invoice' as const,
  number: 'INV-2026-0042',
  currency: 'USD',
  issuedAt: '2026-05-04',
  saleDate: '2026-05-04',
  paymentDueDate: '2026-05-18',
  paymentMethod: 'Bank transfer',
  netTotal: 2000,
  taxTotal: 400,
  grossTotal: 2400,
  paidTotal: 0,
  amountDue: 2400,
  overpayment: 0,
  amountInWords: 'two thousand four hundred 00/100',
  ksefReferenceNumber: null as string | null,
  ksefProcessedAt: null as string | null,
  lines: [
    {
      ordinal: 1,
      name: 'Cloud hosting — annual plan',
      unit: 'ea',
      quantity: 1,
      unitNetPrice: 500,
      taxRate: 0.2,
      netValue: 500,
      grossValue: 600,
    },
    {
      ordinal: 2,
      name: 'Professional services — onboarding',
      unit: 'hr',
      quantity: 10,
      unitNetPrice: 150,
      taxRate: 0.2,
      netValue: 1500,
      grossValue: 1800,
    },
  ],
  vatSummary: [{ taxRate: 0.2, netTotal: 2000, vatAmount: 400, grossTotal: 2400 }],
  seller: {
    legalName: 'Acme Supplies Ltd.',
    addressLine1: '100 Market Street, Suite 4',
    addressLine2: '',
    postalCode: '10001',
    city: 'New York',
    taxId: '12-3456789',
    bankName: 'Example Bank',
    bankAccount: 'US64 EXAMPLE 0000 0000 0000 00',
    swift: 'EXAMPUS33',
  },
  buyer: {
    name: 'Globex Trading Co.',
    taxId: '98-7654321',
    addressLine1: '250 Commerce Avenue',
    postalCode: '60601',
    city: 'Chicago',
  },
};

/**
 * Issue #888 — the canvas draws what the PDF prints: a label the template
 * leaves empty (or blank) comes from this module's `pdf.*` keys **in the
 * language of the tree being edited**, the fallback `sections.ts` takes with
 * `str(props, key, labels[…])`; a label the operator typed is drawn as typed.
 *
 * The edited tree's language is the render environment the document-template
 * editor provides around its canvas (`useBlockRenderEnvironment`). When it is
 * the administrator's language the loaded bundle already holds it; otherwise
 * that language's bundle is fetched once per session, and until it arrives the
 * administrator's language stands in.
 */
const treeBundles = new Map<SupportedAdminLanguage, Promise<Bundle>>();

function treeBundle(language: SupportedAdminLanguage): Promise<Bundle> {
  let pending = treeBundles.get(language);
  if (!pending) {
    pending = getBundles(language).then((response) => response.bundles);
    // A failed read is not remembered, so the next canvas tries again.
    pending.catch(() => treeBundles.delete(language));
    treeBundles.set(language, pending);
  }
  return pending;
}

type TreeLabel = (key: string, params?: Record<string, string | number>) => string;

function useTreeLabels(): TreeLabel {
  const { language: treeLanguage } = useBlockRenderEnvironment();
  const target = supportedLanguageOf(treeLanguage);
  const { language: admin, bundle, fallbackBundle, t } = useTranslationContext();
  const held = target === admin ? bundle : target === 'en' ? fallbackBundle : undefined;
  const [fetched, setFetched] = useState<{ language: SupportedAdminLanguage; bundle: Bundle } | null>(null);
  useEffect(() => {
    if (held) return undefined;
    let live = true;
    treeBundle(target).then(
      (loaded) => {
        if (live) setFetched({ language: target, bundle: loaded });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [held, target]);
  const own = held ?? (fetched?.language === target ? fetched.bundle : undefined);
  const english = admin === 'en' ? bundle : fallbackBundle;
  return (key, params) => {
    if (own) {
      const result = resolve({
        scope: 'invoices',
        key,
        language: target,
        bundle: own,
        ...(english ? { fallbackBundle: english } : {}),
        ...(params ? { params } : {}),
      });
      if (result.outcome !== 'placeholder') return result.value;
    }
    return t('invoices', key, params);
  };
}

/** The operator's label when it has text, as `sections.ts`'s `str` reads one; else `fallback`. */
function typed(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** A unit price: its significant places, up to four (owner ruling of 2026-10-25), as the PDF prints it. */
function unitMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: unitPriceFractionDigits(n) });
}
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Interpolate `{{var invoice.x}}` / `{{var seller.x}}` tokens (mirrors backend). */
function interpolate(text: string): string {
  const inv = sampleInvoice;
  const map: Record<string, string> = {
    'invoice.number': inv.number,
    'invoice.total': money(inv.grossTotal),
    'invoice.currency': inv.currency,
    'invoice.issuedAt': inv.issuedAt,
    'invoice.saleDate': inv.saleDate,
    'invoice.amountDue': money(inv.amountDue),
    'invoice.overpayment': money(inv.overpayment),
    'buyer.name': inv.buyer.name,
    'seller.legalName': inv.seller.legalName,
    'seller.taxId': inv.seller.taxId,
  };
  return text.replace(/\{\{\s*var\s+([\w.]+)\s*\}\}/g, (_m, key: string) => map[key] ?? '');
}

const YES_NO = [
  { label: 'Yes', value: true },
  { label: 'No', value: false },
];

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

type Align = 'left' | 'center' | 'right';

function radio(label: string) {
  return { type: 'radio' as const, label, options: YES_NO };
}

function alignField(label = 'Align') {
  return { type: 'select' as const, label, options: ALIGN_OPTIONS };
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asAlign(v: unknown, fallback: Align = 'left'): Align {
  return v === 'center' || v === 'right' || v === 'left' ? v : fallback;
}

function asColor(v: unknown, fallback?: string): string | undefined {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

const docStyle: CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  color: '#0f172a',
  background: '#ffffff',
  margin: '6px 0',
};
const thStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 10,
  textAlign: 'left',
  borderBottom: '1px solid #cbd5e1',
  padding: '3px 6px',
  whiteSpace: 'nowrap',
};
const tdStyle: CSSProperties = {
  fontSize: 10,
  borderBottom: '1px solid #e2e8f0',
  padding: '3px 6px',
};

function Section({
  children,
  marginTop,
  marginBottom,
  style,
}: {
  children: ReactNode;
  marginTop?: number;
  marginBottom?: number;
  style?: CSSProperties;
}): ReactElement {
  return (
    <div
      style={{
        ...docStyle,
        marginTop: marginTop ?? 6,
        marginBottom: marginBottom ?? 6,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function invoiceSection<T extends ComponentConfig>(config: T): T {
  return definePageBuilderComponent({ ...config, contexts: ['invoice'] }) as T;
}

/* -------------------------------------------------------------------------- */
/* InvoiceHeader                                                              */
/* -------------------------------------------------------------------------- */

type HeaderProps = {
  titleSize?: number;
  titleColor?: string;
  titleBold?: boolean;
  align?: Align;
  showIssuedAt?: boolean;
  showSaleDate?: boolean;
  showPaymentDue?: boolean;
  showPaymentMethod?: boolean;
  labelIssuedAt?: string;
  labelSaleDate?: string;
  labelPaymentDue?: string;
  labelPaymentMethod?: string;
  /** The KSeF number row's label (T137). There is no show/hide prop by design. */
  labelKsefNumber?: string;
  marginTop?: number;
  marginBottom?: number;
};

const InvoiceHeader = invoiceSection({
  label: 'Header (number + dates)',
  fields: {
    titleSize: { type: 'number', label: 'Title size' },
    titleColor: createColorField({ label: 'Title color' }),
    titleBold: radio('Title bold'),
    align: alignField(),
    showIssuedAt: radio('Show issue date'),
    showSaleDate: radio('Show sale date'),
    showPaymentDue: radio('Show payment due'),
    showPaymentMethod: radio('Show payment method'),
    labelIssuedAt: { type: 'text', label: 'Issue date label' },
    labelSaleDate: { type: 'text', label: 'Sale date label' },
    labelPaymentDue: { type: 'text', label: 'Payment due label' },
    labelPaymentMethod: { type: 'text', label: 'Payment method label' },
    labelKsefNumber: { type: 'text', label: 'KSeF number label' },
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    titleSize: 14,
    titleColor: '#0f172a',
    titleBold: true,
    align: 'left' as Align,
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
  render: (props) => <InvoiceHeaderCanvas {...props} />,
}) as ComponentConfig<HeaderProps>;

function InvoiceHeaderCanvas(props: HeaderProps): ReactElement {
  const label = useTreeLabels();
  const inv = sampleInvoice;
  const align = asAlign(props.align, 'left');
  const titleSize = asNum(props.titleSize, 14);
  const titleBold = asBool(props.titleBold, true);
  const titleColor = asColor(props.titleColor, '#0f172a');
  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, 12)}>
      <div
        style={{
          fontSize: titleSize,
          fontWeight: titleBold ? 700 : 400,
          color: titleColor,
          textAlign: align,
          marginBottom: 6,
        }}
      >
        {label('pdf.title.numbered', { title: label('pdf.title.invoice'), number: inv.number })}
      </div>
      {asBool(props.showIssuedAt, true) ? (
        <div style={{ textAlign: align }}>
          {typed(props.labelIssuedAt, label('pdf.label.issuedAt'))}: {inv.issuedAt}
        </div>
      ) : null}
      {asBool(props.showSaleDate, true) ? (
        <div style={{ textAlign: align }}>
          {typed(props.labelSaleDate, label('pdf.label.saleDate'))}: {inv.saleDate}
        </div>
      ) : null}
      {asBool(props.showPaymentDue, true) ? (
        <div style={{ textAlign: align }}>
          {typed(props.labelPaymentDue, label('pdf.label.paymentDue'))}: {inv.paymentDueDate}
        </div>
      ) : null}
      {asBool(props.showPaymentMethod, true) ? (
        <div style={{ textAlign: align }}>
          {typed(props.labelPaymentMethod, label('pdf.label.paymentMethod'))}: {inv.paymentMethod}
        </div>
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* InvoiceParties                                                             */
/* -------------------------------------------------------------------------- */

type PartiesProps = {
  sellerLabel?: string;
  buyerLabel?: string;
  showSellerBank?: boolean;
  showSellerSwift?: boolean;
  showBuyerTaxId?: boolean;
  labelFontSize?: number;
  bodyFontSize?: number;
  columnGap?: number;
  sellerWidthPercent?: number;
  marginTop?: number;
  marginBottom?: number;
};

const InvoiceParties = invoiceSection({
  label: 'Seller & buyer',
  fields: {
    sellerLabel: { type: 'text', label: 'Seller label' },
    buyerLabel: { type: 'text', label: 'Buyer label' },
    showSellerBank: radio('Show seller bank'),
    showSellerSwift: radio('Show seller SWIFT'),
    showBuyerTaxId: radio('Show buyer tax ID'),
    labelFontSize: { type: 'number', label: 'Label font size' },
    bodyFontSize: { type: 'number', label: 'Body font size' },
    columnGap: { type: 'number', label: 'Column gap (px)' },
    sellerWidthPercent: { type: 'number', label: 'Seller width %' },
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
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
  render: (props) => <InvoicePartiesCanvas {...props} />,
}) as ComponentConfig<PartiesProps>;

function InvoicePartiesCanvas(props: PartiesProps): ReactElement {
  const label = useTreeLabels();
  const { seller, buyer } = sampleInvoice;
  const labelFs = asNum(props.labelFontSize, 10);
  const bodyFs = asNum(props.bodyFontSize, 10);
  const sellerPct = Math.min(70, Math.max(30, asNum(props.sellerWidthPercent, 50)));
  const gap = asNum(props.columnGap, 16);
  const labelStyle: CSSProperties = { fontWeight: 700, fontSize: labelFs, marginBottom: 2 };
  const bodyStyle: CSSProperties = { fontSize: bodyFs };
  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, 16)}>
      <div style={{ display: 'flex', gap }}>
        <div style={{ flex: `0 0 ${sellerPct}%` }}>
          <div style={labelStyle}>{typed(props.sellerLabel, label('pdf.label.seller'))}</div>
          <div style={bodyStyle}>{seller.legalName}</div>
          <div style={bodyStyle}>{seller.addressLine1}</div>
          {seller.addressLine2 ? <div style={bodyStyle}>{seller.addressLine2}</div> : null}
          <div style={bodyStyle}>
            {seller.postalCode} {seller.city}
          </div>
          <div style={bodyStyle}>
            {label('pdf.label.taxId')}: {seller.taxId}
          </div>
          {asBool(props.showSellerBank, true) && seller.bankAccount ? (
            <div style={bodyStyle}>
              {seller.bankName} {seller.bankAccount}
            </div>
          ) : null}
          {asBool(props.showSellerSwift, true) && seller.swift ? (
            <div style={bodyStyle}>SWIFT: {seller.swift}</div>
          ) : null}
        </div>
        <div style={{ flex: `1 1 ${100 - sellerPct}%` }}>
          <div style={labelStyle}>{typed(props.buyerLabel, label('pdf.label.buyer'))}</div>
          <div style={bodyStyle}>{buyer.name}</div>
          <div style={bodyStyle}>{buyer.addressLine1}</div>
          <div style={bodyStyle}>
            {buyer.postalCode} {buyer.city}
          </div>
          {asBool(props.showBuyerTaxId, true) && buyer.taxId ? (
            <div style={bodyStyle}>
              {label('pdf.label.taxId')}: {buyer.taxId}
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* InvoiceLineItems                                                           */
/* -------------------------------------------------------------------------- */

type LineItemsProps = {
  fontSize?: number;
  headerBold?: boolean;
  headerBackground?: string;
  headerColor?: string;
  borderColor?: string;
  zebra?: boolean;
  showUnit?: boolean;
  showQty?: boolean;
  showUnitNet?: boolean;
  showTaxRate?: boolean;
  showNet?: boolean;
  showGross?: boolean;
  marginTop?: number;
  marginBottom?: number;
};

const InvoiceLineItems = invoiceSection({
  label: 'Line items table',
  fields: {
    fontSize: { type: 'number', label: 'Font size' },
    headerBold: radio('Header bold'),
    headerBackground: createColorField({ label: 'Header background' }),
    headerColor: createColorField({ label: 'Header text color' }),
    borderColor: createColorField({ label: 'Border color' }),
    zebra: radio('Zebra rows'),
    showUnit: radio('Show unit'),
    showQty: radio('Show quantity'),
    showUnitNet: radio('Show unit net price'),
    showTaxRate: radio('Show tax rate'),
    showNet: radio('Show net value'),
    showGross: radio('Show gross value'),
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
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
  render: (props) => <InvoiceLineItemsCanvas {...props} />,
}) as ComponentConfig<LineItemsProps>;

function InvoiceLineItemsCanvas(props: LineItemsProps): ReactElement {
  const label = useTreeLabels();
  const fontSize = asNum(props.fontSize, 8);
  const headerBold = asBool(props.headerBold, true);
  const headerBg = asColor(props.headerBackground);
  const headerColor = asColor(props.headerColor);
  const borderColor = asColor(props.borderColor, '#cbd5e1') ?? '#cbd5e1';
  const zebra = asBool(props.zebra, false);
  const showUnit = asBool(props.showUnit, true);
  const showQty = asBool(props.showQty, true);
  const showUnitNet = asBool(props.showUnitNet, true);
  const showTaxRate = asBool(props.showTaxRate, true);
  const showNet = asBool(props.showNet, true);
  const showGross = asBool(props.showGross, true);

  type Col = { key: string; label: string; right?: boolean };
  const cols: Col[] = [
    { key: 'lp', label: label('pdf.column.ordinal') },
    { key: 'name', label: label('pdf.column.name') },
  ];
  if (showUnit) cols.push({ key: 'unit', label: label('pdf.column.unit') });
  if (showQty) cols.push({ key: 'qty', label: label('pdf.column.quantity'), right: true });
  if (showUnitNet) cols.push({ key: 'unitNet', label: label('pdf.column.unitNet'), right: true });
  if (showTaxRate) cols.push({ key: 'tax', label: label('pdf.column.taxRate'), right: true });
  if (showNet) cols.push({ key: 'net', label: label('pdf.column.net'), right: true });
  if (showGross) cols.push({ key: 'gross', label: label('pdf.column.gross'), right: true });

  const head: CSSProperties = {
    ...thStyle,
    fontSize,
    fontWeight: headerBold ? 600 : 400,
    color: headerColor,
    background: headerBg,
    borderBottom: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
  };
  const cell = (right?: boolean, fill?: string): CSSProperties => ({
    ...tdStyle,
    fontSize,
    textAlign: right ? 'right' : 'left',
    background: fill,
    borderBottom: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
  });

  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, 12)}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${borderColor}` }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ ...head, textAlign: c.right ? 'right' : 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sampleInvoice.lines.map((l, i) => {
            const fill = zebra && i % 2 === 1 ? '#f8fafc' : undefined;
            const values: Record<string, string> = {
              lp: String(l.ordinal),
              name: l.name,
              unit: l.unit,
              qty: String(l.quantity),
              unitNet: unitMoney(l.unitNetPrice),
              tax: pct(l.taxRate),
              net: money(l.netValue),
              gross: money(l.grossValue),
            };
            return (
              <tr key={l.ordinal}>
                {cols.map((c) => (
                  <td key={c.key} style={cell(c.right, fill)}>
                    {values[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* InvoiceVatSummary                                                          */
/* -------------------------------------------------------------------------- */

type VatSummaryProps = {
  fontSize?: number;
  headerBold?: boolean;
  headerBackground?: string;
  headerColor?: string;
  borderColor?: string;
  showTotalRow?: boolean;
  totalLabel?: string;
  marginTop?: number;
  marginBottom?: number;
};

const InvoiceVatSummary = invoiceSection({
  label: 'VAT summary',
  fields: {
    fontSize: { type: 'number', label: 'Font size' },
    headerBold: radio('Header bold'),
    headerBackground: createColorField({ label: 'Header background' }),
    headerColor: createColorField({ label: 'Header text color' }),
    borderColor: createColorField({ label: 'Border color' }),
    showTotalRow: radio('Show total row'),
    totalLabel: { type: 'text', label: 'Total row label' },
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
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
  render: (props) => <InvoiceVatSummaryCanvas {...props} />,
}) as ComponentConfig<VatSummaryProps>;

function InvoiceVatSummaryCanvas(props: VatSummaryProps): ReactElement {
  const label = useTreeLabels();
  const inv = sampleInvoice;
  const fontSize = asNum(props.fontSize, 8);
  const headerBold = asBool(props.headerBold, true);
  const headerBg = asColor(props.headerBackground);
  const headerColor = asColor(props.headerColor);
  const borderColor = asColor(props.borderColor, '#cbd5e1') ?? '#cbd5e1';
  const headers = [
    label('pdf.vat.rate'),
    label('pdf.column.net'),
    label('pdf.vat.amount'),
    label('pdf.column.gross'),
  ];
  const head = (i: number): CSSProperties => ({
    ...thStyle,
    fontSize,
    fontWeight: headerBold ? 600 : 400,
    color: headerColor,
    background: headerBg,
    textAlign: i === 0 ? 'left' : 'right',
    borderBottom: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
  });
  const cell = (right?: boolean, bold?: boolean): CSSProperties => ({
    ...tdStyle,
    fontSize,
    fontWeight: bold ? 700 : 400,
    textAlign: right ? 'right' : 'left',
    borderBottom: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`,
  });
  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, 12)}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${borderColor}` }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} style={head(i)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inv.vatSummary.map((v) => (
            <tr key={v.taxRate}>
              <td style={cell()}>{pct(v.taxRate)}</td>
              <td style={cell(true)}>{money(v.netTotal)}</td>
              <td style={cell(true)}>{money(v.vatAmount)}</td>
              <td style={cell(true)}>{money(v.grossTotal)}</td>
            </tr>
          ))}
          {asBool(props.showTotalRow, true) ? (
            <tr>
              <td style={cell(false, true)}>{typed(props.totalLabel, label('pdf.label.total'))}</td>
              <td style={cell(true, true)}>{money(inv.netTotal)}</td>
              <td style={cell(true, true)}>{money(inv.taxTotal)}</td>
              <td style={cell(true, true)}>{money(inv.grossTotal)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* InvoiceTotals                                                              */
/* -------------------------------------------------------------------------- */

type TotalsProps = {
  align?: Align;
  fontSize?: number;
  color?: string;
  amountDueColor?: string;
  amountDueBold?: boolean;
  amountInWordsItalics?: boolean;
  showPaid?: boolean;
  showAmountDue?: boolean;
  showOverpayment?: boolean;
  showGross?: boolean;
  showAmountInWords?: boolean;
  labelPaid?: string;
  labelAmountDue?: string;
  labelOverpayment?: string;
  labelGross?: string;
  labelInWords?: string;
  marginTop?: number;
  marginBottom?: number;
};

const InvoiceTotals = invoiceSection({
  label: 'Totals & amount in words',
  fields: {
    align: alignField(),
    fontSize: { type: 'number', label: 'Font size' },
    color: createColorField({ label: 'Text color' }),
    amountDueColor: createColorField({ label: 'Amount due color' }),
    amountDueBold: radio('Amount due bold'),
    amountInWordsItalics: radio('Amount in words italics'),
    showPaid: radio('Show paid'),
    showAmountDue: radio('Show amount due'),
    showOverpayment: radio('Show overpayment'),
    showGross: radio('Show gross'),
    showAmountInWords: radio('Show amount in words'),
    labelPaid: { type: 'text', label: 'Paid label' },
    labelAmountDue: { type: 'text', label: 'Amount due label' },
    labelOverpayment: { type: 'text', label: 'Overpayment label' },
    labelGross: { type: 'text', label: 'Gross label' },
    labelInWords: { type: 'text', label: 'In words label' },
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    align: 'right' as Align,
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
    labelPaid: 'Paid',
    labelAmountDue: 'Amount due',
    // No default (issue #428): an empty label prints the document language's own.
    labelOverpayment: '',
    labelGross: 'Total',
    labelInWords: 'In words',
    marginTop: 0,
    marginBottom: 16,
  },
  render: (props) => <InvoiceTotalsCanvas {...props} />,
}) as ComponentConfig<TotalsProps>;

function InvoiceTotalsCanvas(props: TotalsProps): ReactElement {
  const label = useTreeLabels();
  const inv = sampleInvoice;
  const align = asAlign(props.align, 'right');
  const fontSize = asNum(props.fontSize, 10);
  const color = asColor(props.color, '#0f172a');
  const amountDueColor = asColor(props.amountDueColor) ?? color;
  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, 16)}>
      <div style={{ textAlign: align, fontSize, color }}>
        {asBool(props.showPaid, true) ? (
          <div>
            {typed(props.labelPaid, label('pdf.label.paid'))}: {money(inv.paidTotal)} {inv.currency}
          </div>
        ) : null}
        {asBool(props.showAmountDue, true) ? (
          <div
            style={{
              fontWeight: asBool(props.amountDueBold, true) ? 700 : 400,
              color: amountDueColor,
            }}
          >
            {typed(props.labelAmountDue, label('pdf.label.amountDue'))}: {money(inv.amountDue)} {inv.currency}
          </div>
        ) : null}
        {asBool(props.showOverpayment, true) && inv.overpayment > 0 ? (
          <div>
            {typed(props.labelOverpayment, label('pdf.label.overpayment'))}: {money(inv.overpayment)} {inv.currency}
          </div>
        ) : null}
        {asBool(props.showGross, true) ? (
          <div>
            {typed(props.labelGross, label('pdf.label.total'))}: {money(inv.grossTotal)} {inv.currency}
          </div>
        ) : null}
        {asBool(props.showAmountInWords, true) ? (
          <div
            style={{
              fontStyle: asBool(props.amountInWordsItalics, true) ? 'italic' : 'normal',
              marginTop: 6,
            }}
          >
            {typed(props.labelInWords, label('pdf.label.inWords'))}: {inv.amountInWords} {inv.currency}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* InvoiceNotes                                                               */
/* -------------------------------------------------------------------------- */

type TextBlockProps = {
  text?: string;
  align?: Align;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italics?: boolean;
  showTopDivider?: boolean;
  marginTop?: number;
  marginBottom?: number;
};

function renderTextBlock(
  props: TextBlockProps,
  defaults: { fontSize: number; showTopDivider: boolean; marginBottom: number; emptyHint: string },
): ReactElement {
  const align = asAlign(props.align, 'left');
  const fontSize = asNum(props.fontSize, defaults.fontSize);
  const color = asColor(props.color, '#0f172a');
  const raw = typeof props.text === 'string' ? props.text : '';
  return (
    <Section marginTop={asNum(props.marginTop, 0)} marginBottom={asNum(props.marginBottom, defaults.marginBottom)}>
      {asBool(props.showTopDivider, defaults.showTopDivider) ? (
        <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '0 0 8px' }} />
      ) : null}
      {raw ? (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            textAlign: align,
            fontSize,
            color,
            fontWeight: asBool(props.bold, false) ? 700 : 400,
            fontStyle: asBool(props.italics, false) ? 'italic' : 'normal',
          }}
        >
          {interpolate(raw)}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#94a3b8', textAlign: align }}>{defaults.emptyHint}</div>
      )}
    </Section>
  );
}

const InvoiceNotes = invoiceSection({
  label: 'Notes (free text)',
  fields: {
    text: { type: 'textarea', label: 'Notes text' },
    align: alignField(),
    fontSize: { type: 'number', label: 'Font size' },
    color: createColorField({ label: 'Text color' }),
    bold: radio('Bold'),
    italics: radio('Italics'),
    showTopDivider: radio('Top divider'),
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    text: '',
    align: 'left' as Align,
    fontSize: 11,
    color: '#0f172a',
    bold: false,
    italics: false,
    showTopDivider: false,
    marginTop: 0,
    marginBottom: 8,
  },
  render: (props) =>
    renderTextBlock(props, {
      fontSize: 11,
      showTopDivider: false,
      marginBottom: 8,
      emptyHint: `Free text — supports {{var invoice.number}} tokens`,
    }),
}) as ComponentConfig<TextBlockProps>;

/* -------------------------------------------------------------------------- */
/* InvoiceSpacer                                                              */
/* -------------------------------------------------------------------------- */

type SpacerProps = {
  height?: number;
  backgroundColor?: string;
};

const InvoiceSpacer = invoiceSection({
  label: 'Spacer',
  fields: {
    height: { type: 'number', label: 'Height (px)' },
    backgroundColor: createColorField({ label: 'Background color' }),
  },
  defaultProps: {
    height: 16,
    backgroundColor: '',
  },
  render: (props) => {
    const height = Math.min(120, Math.max(4, asNum(props.height, 16)));
    const bg = asColor(props.backgroundColor);
    return (
      <div
        style={{
          height,
          width: '100%',
          background: bg ?? 'transparent',
          margin: '0',
        }}
        aria-hidden
      />
    );
  },
}) as ComponentConfig<SpacerProps>;

/* -------------------------------------------------------------------------- */
/* InvoiceDivider                                                             */
/* -------------------------------------------------------------------------- */

type DividerProps = {
  thickness?: number;
  color?: string;
  style?: 'solid' | 'dashed';
  widthPercent?: number;
  align?: Align;
  marginY?: number;
};

const InvoiceDivider = invoiceSection({
  label: 'Divider',
  fields: {
    thickness: { type: 'number', label: 'Thickness (px)' },
    color: createColorField({ label: 'Color' }),
    style: {
      type: 'select',
      label: 'Style',
      options: [
        { label: 'Solid', value: 'solid' },
        { label: 'Dashed', value: 'dashed' },
      ],
    },
    widthPercent: { type: 'number', label: 'Width %' },
    align: alignField(),
    marginY: { type: 'number', label: 'Vertical margin (px)' },
  },
  defaultProps: {
    thickness: 1,
    color: '#e5e7eb',
    style: 'solid' as const,
    widthPercent: 100,
    align: 'left' as Align,
    marginY: 8,
  },
  render: (props) => {
    const thickness = Math.min(8, Math.max(1, asNum(props.thickness, 1)));
    const color = asColor(props.color, '#e5e7eb') ?? '#e5e7eb';
    const widthPercent = Math.min(100, Math.max(10, asNum(props.widthPercent, 100)));
    const align = asAlign(props.align, 'left');
    const marginY = asNum(props.marginY, 8);
    const dashed = props.style === 'dashed';
    const justify =
      align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    return (
      <div style={{ display: 'flex', justifyContent: justify, margin: `${marginY}px 0` }}>
        <div
          style={{
            width: `${widthPercent}%`,
            borderTop: `${thickness}px ${dashed ? 'dashed' : 'solid'} ${color}`,
          }}
        />
      </div>
    );
  },
}) as ComponentConfig<DividerProps>;

/* -------------------------------------------------------------------------- */
/* InvoiceLogo                                                                */
/* -------------------------------------------------------------------------- */

type LogoProps = {
  imageSource: 'url' | 'library';
  src: string;
  assetId: string;
  width: number;
  maxHeight: number;
  align: Align;
  marginBottom: number;
};

const InvoiceLogo = invoiceSection({
  label: 'Logo',
  fields: {
    imageSource: createImageSourceField(),
    src: createImageUrlField('Image URL'),
    assetId: createImageAssetField('Image'),
    width: { type: 'number', label: 'Width (px)' },
    maxHeight: { type: 'number', label: 'Max height (px)' },
    align: alignField(),
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    imageSource: 'url' as const,
    src: '',
    assetId: '',
    width: 140,
    maxHeight: 80,
    align: 'center' as Align,
    marginBottom: 12,
  },
  resolveFields: (data, { fields }) => {
    const source = data.props['imageSource'] === 'library' ? 'library' : 'url';
    const next = { ...fields };
    if (source === 'library') {
      delete next['src'];
    } else {
      delete next['assetId'];
    }
    return next;
  },
  resolveData: async ({ props }) => {
    const source = props['imageSource'] === 'library' ? 'library' : 'url';
    let src = typeof props['src'] === 'string' ? props['src'] : '';
    const assetId = typeof props['assetId'] === 'string' ? props['assetId'] : '';
    if (source === 'library' && assetId) {
      try {
        const detail = await fetchAssetDetail(assetId);
        src = toAbsoluteAssetUrl(detail.url);
      } catch {
        /* keep previous src */
      }
    }
    if (source === 'url') {
      return { props: { ...props, imageSource: 'url', assetId: '', src } };
    }
    return { props: { ...props, imageSource: 'library', assetId, src } };
  },
  render: (props) => {
    const src = typeof props.src === 'string' ? props.src.trim() : '';
    const width = asNum(props.width, 140);
    const maxHeight = asNum(props.maxHeight, 80);
    const align = asAlign(props.align, 'center');
    const marginBottom = asNum(props.marginBottom, 12);
    const imgMargin =
      align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0';
    return (
      <div style={{ textAlign: align, marginBottom, width: '100%' }}>
        {src ? (
          <img
            src={src}
            alt="Logo"
            style={{
              display: 'block',
              width,
              maxWidth: '100%',
              maxHeight,
              height: 'auto',
              objectFit: 'contain',
              margin: imgMargin,
            }}
          />
        ) : (
          <div
            style={{
              display: 'inline-block',
              width,
              maxWidth: '100%',
              minHeight: 40,
              maxHeight,
              background: '#e2e8f0',
              color: '#64748b',
              fontSize: 12,
              lineHeight: '40px',
              textAlign: 'center',
              margin: imgMargin,
            }}
          >
            [Logo]
          </div>
        )}
      </div>
    );
  },
}) as unknown as ComponentConfig<LogoProps>;

/* -------------------------------------------------------------------------- */
/* InvoiceFooter                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_FOOTER_TEXT =
  'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}';

const InvoiceFooter = invoiceSection({
  label: 'Footer / legal',
  fields: {
    text: { type: 'textarea', label: 'Footer text' },
    align: alignField(),
    fontSize: { type: 'number', label: 'Font size' },
    color: createColorField({ label: 'Text color' }),
    bold: radio('Bold'),
    italics: radio('Italics'),
    showTopDivider: radio('Top divider'),
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    text: DEFAULT_FOOTER_TEXT,
    align: 'center' as Align,
    fontSize: 9,
    color: '#0f172a',
    bold: false,
    italics: false,
    showTopDivider: true,
    marginTop: 0,
    marginBottom: 8,
  },
  render: (props) => <InvoiceFooterCanvas {...props} />,
}) as ComponentConfig<TextBlockProps>;

function InvoiceFooterCanvas(props: TextBlockProps): ReactElement {
  // An empty footer prints the default one in the document's language, as an
  // empty label does (issue #437).
  const label = useTreeLabels();
  const text = typed(props.text, label('pdf.footer.default'));
  return renderTextBlock(
    { ...props, text },
    {
      fontSize: 9,
      showTopDivider: true,
      marginBottom: 8,
      emptyHint: text,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Config export                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The invoice renderer map — **the React half only**, keyed by namespaced block
 * name (feature 096, T303; `contracts/block-definition.md` §4.3).
 *
 * **The `invoice` category is gone.** It is declared by `invoices` (with a
 * `weight`, which is what makes `invoices` the namer) and jointly by `ksef`,
 * and served merged by `GET /api/v1/admin/cms/page-builder/config`. Switching
 * `invoices` off therefore leaves the section titled by `ksef`'s declaration
 * with `ksef.InvoiceSection` still insertable — which a category list in this
 * file could not express.
 *
 * **Every entry is this module's own.** A block another module declares is not
 * bound here: its binding lives with its declarant. Since
 * `specs/152-compare-pdf-template/` invoice templates are edited in the
 * document-template editor, which takes each entry below through this module's
 * `document` block contributions (`../document-blocks/`) and draws a block
 * another module contributes to invoices as its neutral stand-in. The PDF — the
 * legal document — renders it through the contributor's registration on the
 * backend.
 */
export const invoicePuckConfig: Config = {
  components: {
    'invoices.InvoiceHeader': InvoiceHeader,
    'invoices.InvoiceParties': InvoiceParties,
    'invoices.InvoiceLineItems': InvoiceLineItems,
    'invoices.InvoiceVatSummary': InvoiceVatSummary,
    'invoices.InvoiceTotals': InvoiceTotals,
    'invoices.InvoiceNotes': InvoiceNotes,
    'invoices.InvoiceSpacer': InvoiceSpacer,
    'invoices.InvoiceDivider': InvoiceDivider,
    'invoices.InvoiceLogo': InvoiceLogo,
    'invoices.InvoiceFooter': InvoiceFooter,
  },
};
