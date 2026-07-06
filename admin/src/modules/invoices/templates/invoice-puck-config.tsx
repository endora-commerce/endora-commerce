import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { Config, ComponentConfig } from '@measured/puck';

/**
 * Dedicated Puck config for invoice PDF templates (feature 047, US6). Kept in
 * the admin module (not the shared cms-components package) because invoice
 * authoring is admin-only. The real PDF is produced server-side by pdfmake
 * (`backend/.../pdf-components/sections.ts`); these on-canvas renderers mirror
 * those section layouts against a representative sample invoice so the author
 * sees the actual content of each dropped block instead of a placeholder.
 * Component names + the InvoiceNotes `text` field MUST match the backend tree
 * mapper / descriptor.
 */

/**
 * Representative sample invoice — a frontend mirror of the backend
 * `sampleInvoiceDetail()` used by the `/preview` endpoint, so the on-canvas
 * content matches the rendered PDF.
 */
const sampleInvoice = {
  kind: 'invoice' as const,
  number: 'FV 26/2026',
  currency: 'PLN',
  issuedAt: '2026-05-04',
  saleDate: '2026-05-04',
  paymentDueDate: '2026-05-18',
  paymentMethod: 'Przelew',
  netTotal: 5405,
  taxTotal: 1243.15,
  grossTotal: 6648.15,
  paidTotal: 0,
  amountDue: 6648.15,
  amountInWords: 'sześć tysięcy sześćset czterdzieści osiem 15/100',
  ksefReferenceNumber: null as string | null,
  ksefProcessedAt: null as string | null,
  lines: [
    { ordinal: 1, name: 'Example Server', unit: 'szt.', quantity: 1, unitNetPrice: 900, taxRate: 0.23, netValue: 900, grossValue: 1107 },
    { ordinal: 2, name: 'Example Labour Hours', unit: 'h', quantity: 26.5, unitNetPrice: 170, taxRate: 0.23, netValue: 4505, grossValue: 5541.15 },
  ],
  vatSummary: [{ taxRate: 0.23, netTotal: 5405, vatAmount: 1243.15, grossTotal: 6648.15 }],
  seller: {
    legalName: 'Example Seller Sp. z o.o.',
    addressLine1: 'ul. Przykładowa 2',
    addressLine2: '',
    postalCode: '00-001',
    city: 'Warszawa',
    taxId: '1234567890',
    bankName: 'Bank Pekao S.A.',
    bankAccount: '00 1234 5678 0000 0000 0000 0000',
    swift: 'PKOPPLPW',
  },
  buyer: {
    name: 'Example Buyer Sp. z o.o.',
    taxId: '1231231230',
    addressLine1: 'ul. Testowa 1',
    postalCode: '00-002',
    city: 'Warszawa',
  },
};

const TITLES: Record<typeof sampleInvoice.kind, string> = {
  invoice: 'Faktura',
};

function money(n: number): string {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    'buyer.name': inv.buyer.name,
    'seller.legalName': inv.seller.legalName,
    'seller.taxId': inv.seller.taxId,
  };
  return text.replace(/\{\{\s*var\s+([\w.]+)\s*\}\}/g, (_m, key: string) => map[key] ?? '');
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
const numTd: CSSProperties = { ...tdStyle, textAlign: 'right' };

function Section({ children }: { children: ReactNode }): ReactElement {
  return <div style={docStyle}>{children}</div>;
}

function renderHeader(): ReactElement {
  const inv = sampleInvoice;
  return (
    <Section>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
        {TITLES[inv.kind]} nr {inv.number}
      </div>
      <div>Data wystawienia: {inv.issuedAt}</div>
      <div>Data sprzedaży: {inv.saleDate}</div>
      <div>Termin płatności: {inv.paymentDueDate}</div>
      <div>Metoda płatności: {inv.paymentMethod}</div>
    </Section>
  );
}

function renderParties(): ReactElement {
  const { seller, buyer } = sampleInvoice;
  return (
    <Section>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: '1 1 50%' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Sprzedawca</div>
          <div>{seller.legalName}</div>
          <div>{seller.addressLine1}</div>
          <div>
            {seller.postalCode} {seller.city}
          </div>
          <div>NIP: {seller.taxId}</div>
          <div>
            {seller.bankName} {seller.bankAccount}
          </div>
          <div>SWIFT: {seller.swift}</div>
        </div>
        <div style={{ flex: '1 1 50%' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Nabywca</div>
          <div>{buyer.name}</div>
          <div>{buyer.addressLine1}</div>
          <div>
            {buyer.postalCode} {buyer.city}
          </div>
          <div>NIP: {buyer.taxId}</div>
        </div>
      </div>
    </Section>
  );
}

function renderLineItems(): ReactElement {
  const headers = ['Lp', 'Nazwa', 'Jedn.', 'Ilość', 'Cena netto', 'Stawka', 'Wartość netto', 'Wartość brutto'];
  return (
    <Section>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sampleInvoice.lines.map((l) => (
            <tr key={l.ordinal}>
              <td style={tdStyle}>{l.ordinal}</td>
              <td style={tdStyle}>{l.name}</td>
              <td style={tdStyle}>{l.unit}</td>
              <td style={numTd}>{l.quantity}</td>
              <td style={numTd}>{money(l.unitNetPrice)}</td>
              <td style={numTd}>{pct(l.taxRate)}</td>
              <td style={numTd}>{money(l.netValue)}</td>
              <td style={numTd}>{money(l.grossValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function renderVatSummary(): ReactElement {
  const inv = sampleInvoice;
  const headers = ['Stawka VAT', 'Wartość netto', 'Kwota VAT', 'Wartość brutto'];
  return (
    <Section>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={{ ...thStyle, textAlign: h === 'Stawka VAT' ? 'left' : 'right' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inv.vatSummary.map((v) => (
            <tr key={v.taxRate}>
              <td style={tdStyle}>{pct(v.taxRate)}</td>
              <td style={numTd}>{money(v.netTotal)}</td>
              <td style={numTd}>{money(v.vatAmount)}</td>
              <td style={numTd}>{money(v.grossTotal)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700 }}>Razem</td>
            <td style={{ ...numTd, fontWeight: 700 }}>{money(inv.netTotal)}</td>
            <td style={{ ...numTd, fontWeight: 700 }}>{money(inv.taxTotal)}</td>
            <td style={{ ...numTd, fontWeight: 700 }}>{money(inv.grossTotal)}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function renderTotals(): ReactElement {
  const inv = sampleInvoice;
  return (
    <Section>
      <div style={{ textAlign: 'right' }}>
        <div>
          Zapłacono: {money(inv.paidTotal)} {inv.currency}
        </div>
        <div style={{ fontWeight: 700 }}>
          Do zapłaty: {money(inv.amountDue)} {inv.currency}
        </div>
        <div>
          Razem: {money(inv.grossTotal)} {inv.currency}
        </div>
        <div style={{ fontStyle: 'italic', marginTop: 6 }}>
          Słownie: {inv.amountInWords} {inv.currency}
        </div>
      </div>
    </Section>
  );
}

function renderKsef(): ReactElement {
  const inv = sampleInvoice;
  return (
    <Section>
      <div style={{ fontSize: 10, color: inv.ksefReferenceNumber ? '#0f172a' : '#94a3b8' }}>
        <div>Numer w KSeF: {inv.ksefReferenceNumber ?? '(nadawany po wysłaniu do KSeF)'}</div>
        {inv.ksefProcessedAt ? <div>Data przetworzenia w KSeF: {inv.ksefProcessedAt}</div> : null}
      </div>
    </Section>
  );
}

function staticSection(render: () => ReactElement): ComponentConfig {
  return { fields: {}, render };
}

const notes: ComponentConfig<{ text: string }> = {
  fields: { text: { type: 'textarea', label: 'Notes text' } },
  defaultProps: { text: '' },
  render: ({ text }) => (
    <Section>
      {text ? (
        <div style={{ whiteSpace: 'pre-wrap' }}>{interpolate(text)}</div>
      ) : (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          Free text — supports {'{{var invoice.number}}'} tokens
        </div>
      )}
    </Section>
  ),
};

export const invoicePuckConfig: Config = {
  components: {
    InvoiceHeader: staticSection(renderHeader),
    InvoiceParties: staticSection(renderParties),
    InvoiceLineItems: staticSection(renderLineItems),
    InvoiceVatSummary: staticSection(renderVatSummary),
    InvoiceTotals: staticSection(renderTotals),
    InvoiceNotes: notes as unknown as ComponentConfig,
    InvoiceKsef: staticSection(renderKsef),
  },
  categories: {
    invoice: {
      title: 'Invoice sections',
      components: [
        'InvoiceHeader',
        'InvoiceParties',
        'InvoiceLineItems',
        'InvoiceVatSummary',
        'InvoiceTotals',
        'InvoiceNotes',
        'InvoiceKsef',
      ],
    },
  },
};
