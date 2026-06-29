import type { ReactNode } from 'react';
import type { Config, ComponentConfig } from '@measured/puck';

/**
 * Dedicated Puck config for invoice PDF templates (feature 047, US6). Kept in
 * the admin module (not the shared cms-components package) because invoice
 * authoring is admin-only and the real layout is produced server-side by
 * pdfmake — these renderers are arrangement previews of the bounded invoice
 * component set. Component names + the InvoiceNotes `text` field MUST match the
 * backend tree mapper / descriptor.
 */
function PreviewBox({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div
      style={{
        border: '1px dashed #94a3b8',
        borderRadius: 6,
        padding: '10px 12px',
        margin: '6px 0',
        background: '#f8fafc',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{title}</div>
      {hint ? <div style={{ fontSize: 11, color: '#64748b' }}>{hint}</div> : null}
    </div>
  );
}

function staticSection(title: string, hint: string): ComponentConfig {
  return { fields: {}, render: () => <PreviewBox title={title} hint={hint} /> };
}

const notes: ComponentConfig<{ text: string }> = {
  fields: { text: { type: 'textarea', label: 'Notes text' } },
  defaultProps: { text: '' },
  render: ({ text }) => (
    <PreviewBox title="Notes" hint={text || 'Free text — supports {{var invoice.number}}'} />
  ),
};

export const invoicePuckConfig: Config = {
  components: {
    InvoiceHeader: staticSection('Header', 'Invoice number, issue/sale dates, payment terms'),
    InvoiceParties: staticSection('Seller & Buyer', 'Seller (with NIP, bank) + buyer blocks'),
    InvoiceLineItems: staticSection('Line items table', 'Lp · Nazwa · Jedn · Ilość · Cena · Stawka · Netto · Brutto'),
    InvoiceVatSummary: staticSection('VAT summary', 'Per-rate net / VAT / gross + totals'),
    InvoiceTotals: staticSection('Totals & amount in words', 'Paid / due / total + słownie'),
    InvoiceNotes: notes as unknown as ComponentConfig,
    InvoiceKsef: staticSection('KSeF verification', 'KSeF number + processing date (when present)'),
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
