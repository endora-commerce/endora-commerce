import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InvoiceDetail } from '@endora-commerce/contracts';
import {
  INVOICE_PDF_LABEL_KEYS,
  interpolate,
  lineItemsSection,
  money,
  totalsSection,
  unitMoney,
  type InvoicePdfLabels,
} from './sections.js';
import { sampleInvoiceDetail } from './sample.js';

/**
 * Owner ruling of 2026-10-25 (`specs/pricing/worked-examples.md` §10.18) — the
 * invoice's unit net price column shows up to four places (a Polish invoice
 * may: art. 106e ust. 1 pkt 9 names the unit price without prescribing its
 * precision); the line values and the totals keep two.
 */
describe('invoice PDF — unit net price', () => {
  it('shows a unit price with its significant places, up to four', () => {
    expect(unitMoney(0.0125)).toBe('0,0125');
    expect(unitMoney(1.505)).toBe('1,505');
    expect(unitMoney(1.5)).toBe('1,50');
    expect(unitMoney(1234.5)).toBe(money(1234.5));
  });

  it('the lines table prints the unit net price at four places and the line value at two', () => {
    const invoice = {
      lines: [
        { ordinal: 1, name: 'Screw', unit: 'szt.', quantity: 10_000, unitNetPrice: 0.0125, taxRate: 0.23, netValue: 125, grossValue: 153.75 },
      ],
    } as unknown as InvoiceDetail;
    const table = lineItemsSection(invoice) as { table: { body: Array<Array<{ text: string }>> } };
    const row = table.table.body[1]!.map((c) => c.text);
    expect(row).toContain('0,0125');
    expect(row).toContain(money(125));
  });
});

/**
 * Issue #428 point 2 — an invoice paid above its gross shows the amount due
 * clamped at 0 and the excess as an explicit overpayment, never a negative
 * amount due.
 */
describe('invoice PDF — overpayment', () => {
  const pl = JSON.parse(
    readFileSync(new URL('../../../i18n/pl.json', import.meta.url), 'utf8'),
  ) as Record<string, string>;
  const PL: InvoicePdfLabels = Object.fromEntries(
    INVOICE_PDF_LABEL_KEYS.map((key) => [key, pl[key]!]),
  ) as InvoicePdfLabels;
  const texts = (content: unknown): string[] =>
    ((content as { stack: Array<{ text: string }> }).stack ?? []).map((c) => c.text);

  it('prints the overpayment beside an amount due of 0', () => {
    const invoice = { ...sampleInvoiceDetail(), grossTotal: 2400, paidTotal: 2450, amountDue: 0, overpayment: 50 };
    const lines = texts(totalsSection(invoice, 'pl', { showAmountInWords: false }, PL));
    expect(lines).toContain(`Do zapłaty: ${money(0)} USD`);
    expect(lines).toContain(`Nadpłata: ${money(50)} USD`);
  });

  it('takes the label from the template, and can be hidden', () => {
    const invoice = { ...sampleInvoiceDetail(), paidTotal: 2450, amountDue: 0, overpayment: 50 };
    expect(texts(totalsSection(invoice, 'pl', { labelOverpayment: 'Overpayment' }, PL))).toContain(
      `Overpayment: ${money(50)} USD`,
    );
    expect(texts(totalsSection(invoice, 'pl', { showOverpayment: false }, PL)).join('\n')).not.toContain('Nadpłata');
  });

  it('labels it in English on an English document', () => {
    const invoice = { ...sampleInvoiceDetail(), paidTotal: 2450, amountDue: 0, overpayment: 50 };
    expect(texts(totalsSection(invoice, 'en', {}))).toContain(`Overpayment: ${money(50)} USD`);
  });

  it('prints no overpayment line when nothing was overpaid', () => {
    const lines = texts(totalsSection(sampleInvoiceDetail(), 'pl', {}, PL));
    expect(lines.join('\n')).not.toContain('Nadpłata');
  });

  it('offers the overpayment as a merge field', () => {
    const invoice = { ...sampleInvoiceDetail(), overpayment: 50 };
    expect(interpolate('{{var invoice.overpayment}}', invoice)).toBe(money(50));
  });
});
