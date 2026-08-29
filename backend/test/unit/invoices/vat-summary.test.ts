import { describe, expect, it } from 'vitest';
import { buildInvoiceLines } from '../../../../packages/modules/invoices/src/backend/services/invoice-line-builder.js';

describe('buildInvoiceLines — VAT summary & reconciliation', () => {
  it('computes gross from net per line and reconciles totals (single rate)', () => {
    const r = buildInvoiceLines([
      { name: 'A', unit: 'szt.', quantity: 1, unitNetPrice: 900, taxRate: 0.23, netValue: 900 },
      { name: 'B', unit: 'h', quantity: 26.5, unitNetPrice: 170, taxRate: 0.23, netValue: 4505 },
    ]);
    expect(r.netTotal).toBe(5405);
    expect(r.taxTotal).toBe(1243.15);
    expect(r.grossTotal).toBe(6648.15);
    // per-rate reconciliation: net + vat = gross
    for (const row of r.vatSummary) {
      expect(row.netTotal + row.vatAmount).toBeCloseTo(row.grossTotal, 2);
    }
    // Σ gross of rows = grand total
    const sumGross = r.vatSummary.reduce((s, x) => s + x.grossTotal, 0);
    expect(sumGross).toBeCloseTo(r.grossTotal, 2);
  });

  it('groups multiple VAT rates into separate summary rows', () => {
    const r = buildInvoiceLines([
      { name: 'A', unit: 'szt.', quantity: 1, unitNetPrice: 100, taxRate: 0.23, netValue: 100 },
      { name: 'B', unit: 'szt.', quantity: 1, unitNetPrice: 100, taxRate: 0.08, netValue: 100 },
      { name: 'C', unit: 'szt.', quantity: 1, unitNetPrice: 50, taxRate: 0.23, netValue: 50 },
    ]);
    expect(r.vatSummary).toHaveLength(2);
    const r23 = r.vatSummary.find((x) => x.taxRate === 0.23);
    expect(r23?.netTotal).toBe(150);
    expect(r23?.vatAmount).toBeCloseTo(34.5, 2);
    expect(r.grossTotal).toBeCloseTo(292.5, 2);
  });

  it('assigns 1-based ordinals and snapshots line values', () => {
    const r = buildInvoiceLines([
      { name: 'X', unit: 'szt.', quantity: 2, unitNetPrice: 10, taxRate: 0.23, netValue: 20 },
    ]);
    expect(r.lines[0]?.ordinal).toBe(1);
    expect(r.lines[0]?.grossValue).toBeCloseTo(24.6, 2);
  });
});
