import {
  compareDecimals,
  decimalDifference,
  moneySum,
  roundHalfUp,
  vatByRate,
  type InvoiceLine,
  type VatSummaryRow,
} from '@endora-commerce/contracts';

export interface RawOrderLine {
  name: string;
  unit: string;
  quantity: number;
  /** Net unit price, as written (a decimal string, or a number read as its shortest decimal). */
  unitNetPrice: string | number;
  /** Fractional VAT rate, e.g. `0.23`. */
  taxRate: string | number;
  /** Net line value (quantity × unitNetPrice) at two places. */
  netValue: string | number;
  orderItemId?: string | null;
}

/** The line's amounts as the `invoice_lines` columns store them. */
export interface StoredInvoiceLineAmounts {
  unitNetPrice: string;
  taxRate: string;
  netValue: string;
  grossValue: string;
}

export type BuiltInvoiceLine = InvoiceLine & {
  orderItemId?: string | null;
  stored: StoredInvoiceLineAmounts;
};

export interface BuiltInvoiceTotals {
  lines: BuiltInvoiceLine[];
  vatSummary: VatSummaryRow[];
  /** The summary as `invoices.vat_summary` stores it. */
  storedVatSummary: StoredVatRow[];
  /** Two-place decimal strings, as the `invoices` columns store them. */
  netTotal: string;
  taxTotal: string;
  grossTotal: string;
}

/** One stored line's rate, net and gross, as two-place decimals. */
export interface VatSummaryInput {
  taxRate: string | number;
  netValue: string | number;
  grossValue: string | number;
}

/** A per-rate VAT summary in the contract's number shape — each figure a two-place decimal, read losslessly. */
function summaryRows(rows: ReadonlyArray<{ rate: string; net: string; vat: string; gross: string }>): VatSummaryRow[] {
  return rows.map((r) => ({
    taxRate: Number(r.rate),
    netTotal: Number(r.net),
    vatAmount: Number(r.vat),
    grossTotal: Number(r.gross),
  }));
}

/**
 * The rule invoices were issued under before 0.108.0: per rate, the sum of the
 * lines' own rounded grosses minus the sum of their nets. Kept only to show
 * such a document — one with no stored summary — as it was issued.
 */
function legacyVatSummary(lines: readonly VatSummaryInput[]): VatSummaryRow[] {
  const byRate = new Map<string, { net: Array<string | number>; gross: Array<string | number> }>();
  for (const l of lines) {
    const key = roundHalfUp(l.taxRate, 4);
    const cur = byRate.get(key) ?? { net: [], gross: [] };
    cur.net.push(l.netValue);
    cur.gross.push(l.grossValue);
    byRate.set(key, cur);
  }
  return summaryRows(
    [...byRate.entries()]
      .sort((a, b) => compareDecimals(a[0], b[0]))
      .map(([rate, v]) => {
        const net = moneySum(v.net);
        const gross = moneySum(v.gross);
        return { rate, net, vat: roundHalfUp(decimalDifference(gross, net)), gross };
      }),
  );
}

/** A per-rate summary row as `invoices.vat_summary` stores it: two-place decimal strings. */
export interface StoredVatRow {
  taxRate: string;
  netTotal: string;
  vatAmount: string;
  grossTotal: string;
}

/**
 * The per-rate VAT summary a stored document is shown with — **decided by what
 * was stored, never guessed** (review of PR #423). A document issued from
 * 0.108.0 stored the summary it was issued with (`invoices.vat_summary`), and
 * that is what it shows: its line grosses are each line's own rounding and need
 * not add up to it. A document issued before (or imported) stored none, and its
 * summary is derived from its stored lines exactly as it was then — per rate,
 * the lines' grosses minus their nets.
 */
export function readModelVatSummary(
  lines: readonly VatSummaryInput[],
  stored: readonly StoredVatRow[] | null | undefined,
): VatSummaryRow[] {
  if (stored) {
    return summaryRows(
      stored.map((r) => ({ rate: r.taxRate, net: r.netTotal, vat: r.vatAmount, gross: r.grossTotal })),
    );
  }
  return legacyVatSummary(lines);
}

/** The stored form of a summary computed from rows. */
export function storedVatRows(rows: ReadonlyArray<{ rate: string; net: string; vat: string; gross: string }>): StoredVatRow[] {
  return rows.map((r) => ({ taxRate: r.rate, netTotal: r.net, vatAmount: r.vat, grossTotal: r.gross }));
}

/**
 * Builds immutable invoice line snapshots + the per-rate VAT summary + totals
 * from raw order lines. Pure + deterministic so it can be unit-tested in
 * isolation (SC-003: net + VAT = gross per rate; Σ gross = grand total).
 *
 * **The VAT method is the platform's one** (`vatByRate`, owner ruling of
 * 2026-10-24, issue #417; art. 106e ust. 1 pkt 13–14): per rate, VAT on the sum
 * of the lines' nets, rounded half-up once; gross = net + VAT. A line's gross
 * is informational and is the line's own rounding, `round(net × (1 + rate))`
 * (owner ruling of 2026-10-24), so the line grosses may differ from the invoice
 * gross by a cent. The net per line is what the law requires on the line; the
 * gross per line is optional.
 */
export function buildInvoiceLines(raw: RawOrderLine[]): BuiltInvoiceTotals {
  const nets = raw.map((r) => roundHalfUp(r.netValue));
  const vat = vatByRate(
    raw.map((r, i) => ({ net: nets[i]!, rate: r.taxRate })),
    'fraction',
  );
  const lines = raw.map((r, i): BuiltInvoiceLine => {
    const stored: StoredInvoiceLineAmounts = {
      unitNetPrice: roundHalfUp(r.unitNetPrice, 4),
      taxRate: roundHalfUp(r.taxRate, 4),
      netValue: nets[i]!,
      grossValue: vat.lines[i]!.gross,
    };
    return {
      ordinal: i + 1,
      name: r.name,
      unit: r.unit,
      quantity: r.quantity,
      unitNetPrice: Number(stored.unitNetPrice),
      taxRate: Number(stored.taxRate),
      netValue: Number(stored.netValue),
      grossValue: Number(stored.grossValue),
      orderItemId: r.orderItemId ?? null,
      stored,
    };
  });

  return {
    lines,
    vatSummary: summaryRows(vat.rows),
    storedVatSummary: storedVatRows(vat.rows),
    netTotal: vat.net,
    taxTotal: vat.vat,
    grossTotal: vat.gross,
  };
}
