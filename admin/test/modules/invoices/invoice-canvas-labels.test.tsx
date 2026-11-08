import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import invoicesEn from '../../../../packages/modules/invoices/i18n/en.json';
import invoicesPl from '../../../../packages/modules/invoices/i18n/pl.json';

/**
 * Issue #888 — the invoice template editor's canvas draws a label the template
 * leaves empty the way the PDF prints it: from this module's `pdf.*` keys, in
 * the language of the tree being edited (`sections.ts`'s `str(props, key,
 * labels[…])`), and not in English. A label the operator typed shows as typed.
 *
 * The edited tree's language reaches a block through the render environment
 * the document-template editor provides around its canvas. When it is not the
 * administrator's language, the canvas reads that language's bundle itself.
 */

const getBundles = vi.fn();
vi.mock('@endora-commerce/admin-kit/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/i18n')>()),
  getBundles: (language: string) => getBundles(language),
}));

const { invoicePuckConfig } = await import(
  '../../../../packages/modules/invoices/src/admin/templates/invoice-puck-config'
);

const EN = { invoices: invoicesEn as Record<string, string> };
const PL = { invoices: invoicesPl as Record<string, string> };

function draw(
  name: string,
  props: Record<string, unknown>,
  options: { tree: string; admin: 'en' | 'pl' },
): HTMLElement {
  const component = invoicePuckConfig.components[name] as unknown as {
    render: (props: Record<string, unknown>) => ReactElement;
  };
  const Render = component.render;
  return renderWithI18n(
    <BlockRenderEnvironmentProvider value={{ language: options.tree, preview: true }}>
      <Render {...props} />
    </BlockRenderEnvironmentProvider>,
    options.admin === 'pl' ? PL : EN,
    { language: options.admin },
  ).container;
}

const EMPTY_HEADER = { labelIssuedAt: '', labelSaleDate: '', labelPaymentDue: '', labelPaymentMethod: '' };
const EMPTY_TOTALS = { labelPaid: '', labelAmountDue: '', labelGross: '', labelInWords: '' };

describe('invoice canvas labels follow the edited tree (issue #888)', () => {
  beforeEach(() => {
    getBundles.mockReset();
    getBundles.mockImplementation((language: string) =>
      Promise.resolve({ language, bundles: language === 'pl' ? PL : EN }),
    );
  });

  it('the Polish tree draws empty labels in Polish for a Polish administrator', () => {
    draw('invoices.InvoiceHeader', EMPTY_HEADER, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByText('Faktura nr INV-2026-0042')).toBeTruthy();
    expect(screen.getByText(/^Data wystawienia: /)).toBeTruthy();
    expect(screen.getByText(/^Data sprzedaży: /)).toBeTruthy();
    expect(screen.getByText(/^Termin płatności: /)).toBeTruthy();
    expect(screen.getByText(/^Metoda płatności: /)).toBeTruthy();
    expect(screen.queryByText(/Issue date/)).toBeNull();
  });

  it('the Polish tree draws empty labels in Polish for an English administrator', async () => {
    draw('invoices.InvoiceTotals', EMPTY_TOTALS, { tree: 'pl-PL', admin: 'en' });
    await waitFor(() => expect(screen.getByText(/^Zapłacono: /)).toBeTruthy());
    expect(screen.getByText(/^Do zapłaty: /)).toBeTruthy();
    expect(screen.getByText(/^Razem: /)).toBeTruthy();
    expect(screen.getByText(/^Słownie: /)).toBeTruthy();
    expect(getBundles).toHaveBeenCalledWith('pl');
  });

  it('the parties, the tables and the footer draw the Polish tree in Polish', () => {
    draw('invoices.InvoiceParties', { sellerLabel: '', buyerLabel: '' }, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByText('Sprzedawca')).toBeTruthy();
    expect(screen.getByText('Nabywca')).toBeTruthy();
    draw('invoices.InvoiceLineItems', {}, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByRole('columnheader', { name: 'Nazwa' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader', { name: 'Wartość brutto' }).length).toBeGreaterThan(0);
    draw('invoices.InvoiceVatSummary', { totalLabel: '' }, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByRole('columnheader', { name: 'Stawka VAT' })).toBeTruthy();
    expect(screen.getByText('Razem')).toBeTruthy();
    draw('invoices.InvoiceFooter', { text: '' }, { tree: 'pl-PL', admin: 'pl' });
    expect(screen.getByText(/^Dziękujemy za współpracę/)).toBeTruthy();
  });

  it('a label the operator typed is drawn as typed', () => {
    draw(
      'invoices.InvoiceHeader',
      { ...EMPTY_HEADER, labelIssuedAt: 'Wystawiono' },
      { tree: 'pl-PL', admin: 'pl' },
    );
    expect(screen.getByText(/^Wystawiono: /)).toBeTruthy();
    expect(screen.getByText(/^Data sprzedaży: /)).toBeTruthy();
  });
});
