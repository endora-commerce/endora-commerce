import type { InvoiceLine, VatSummaryRow } from '@b2b/contracts';

/** Round to 2 decimals (half-up) for monetary values. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface RawOrderLine {
  name: string;
  unit: string;
  quantity: number;
  /** Net unit price. */
  unitNetPrice: number;
  /** Fractional VAT rate, e.g. 0.23. */
  taxRate: number;
  /** Net line value (quantity × unitNetPrice), as stored on the order. */
  netValue: number;
  orderItemId?: string | null;
}

export interface BuiltInvoiceTotals {
  lines: Array<InvoiceLine & { orderItemId?: string | null }>;
  vatSummary: VatSummaryRow[];
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
}

/**
 * Builds immutable invoice line snapshots + the per-rate VAT summary + totals
 * from raw order lines. Pure + deterministic so it can be unit-tested in
 * isolation (SC-003: net + VAT = gross per rate; Σ gross = grand total).
 */
export function buildInvoiceLines(raw: RawOrderLine[]): BuiltInvoiceTotals {
  const lines = raw.map((r, i) => {
    const netValue = round2(r.netValue);
    const grossValue = round2(netValue * (1 + r.taxRate));
    return {
      ordinal: i + 1,
      name: r.name,
      unit: r.unit,
      quantity: r.quantity,
      unitNetPrice: r.unitNetPrice,
      taxRate: r.taxRate,
      netValue,
      grossValue,
      orderItemId: r.orderItemId ?? null,
    };
  });

  // Group by VAT rate for the summary table.
  const byRate = new Map<number, { net: number; gross: number }>();
  for (const l of lines) {
    const cur = byRate.get(l.taxRate) ?? { net: 0, gross: 0 };
    cur.net += l.netValue;
    cur.gross += l.grossValue;
    byRate.set(l.taxRate, cur);
  }
  const vatSummary: VatSummaryRow[] = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taxRate, v]) => {
      const netTotal = round2(v.net);
      const grossTotal = round2(v.gross);
      return { taxRate, netTotal, vatAmount: round2(grossTotal - netTotal), grossTotal };
    });

  const netTotal = round2(vatSummary.reduce((s, r) => s + r.netTotal, 0));
  const taxTotal = round2(vatSummary.reduce((s, r) => s + r.vatAmount, 0));
  const grossTotal = round2(vatSummary.reduce((s, r) => s + r.grossTotal, 0));

  return { lines, vatSummary, netTotal, taxTotal, grossTotal };
}
