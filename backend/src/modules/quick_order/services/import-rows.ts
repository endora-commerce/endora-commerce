/**
 * Shared import-row model + CSV parsing for quick-order imports (feature 039).
 *
 * Both the CSV path and the Excel path normalize their input into the same
 * `NormalizedRow[]`, which the import pipeline then validates against the
 * catalog. Keeping the parse step pure (no DB) makes it unit-testable.
 */

export interface NormalizedRow {
  /** 1-based source row number (header is row 1; first data row is row 2). */
  rowNumber: number;
  /** Best-effort raw text of the row, shown when the row is rejected. */
  raw: string;
  sku: string;
  /** Raw quantity cell, validated downstream so the reason can be precise. */
  quantityRaw: string;
  /** Non-sku / non-quantity columns, keyed by (lower-cased) header. */
  attributes: Record<string, string>;
}

export interface ParseOutcome {
  /** False when no usable `sku` + `quantity` header was found. */
  headerOk: boolean;
  rows: NormalizedRow[];
}

/**
 * Minimal CSV row parser — handles double-quoted fields with embedded
 * commas and escaped quotes (`""`). Sufficient for the quick-order use
 * case; full RFC 4180 escapes are out of scope.
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else if (ch === '"' && current.length === 0) {
      inQuotes = true;
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Build normalized rows from a header row + the data cell-arrays. Shared by
 * the CSV and Excel parsers so both honour the same column semantics:
 * `sku` + `quantity` are required (order-independent, case-insensitive);
 * every other column becomes a variant attribute value.
 */
export function rowsFromTable(
  header: string[],
  dataRows: Array<{ rowNumber: number; raw: string; cells: string[] }>,
): ParseOutcome {
  const normalizedHeader = header.map((h) => h.trim().toLowerCase());
  const skuIdx = normalizedHeader.indexOf('sku');
  const qtyIdx = normalizedHeader.indexOf('quantity');
  if (skuIdx === -1 || qtyIdx === -1) {
    return { headerOk: false, rows: [] };
  }

  const attributeColumns = normalizedHeader
    .map((name, idx) => ({ name, idx }))
    .filter(({ name, idx }) => idx !== skuIdx && idx !== qtyIdx && name.length > 0);

  const rows: NormalizedRow[] = [];
  for (const { rowNumber, raw, cells } of dataRows) {
    const sku = (cells[skuIdx] ?? '').trim();
    const quantityRaw = (cells[qtyIdx] ?? '').trim();
    const attributes: Record<string, string> = {};
    for (const { name, idx } of attributeColumns) {
      const value = (cells[idx] ?? '').trim();
      if (value.length > 0) attributes[name] = value;
    }
    rows.push({ rowNumber, raw, sku, quantityRaw, attributes });
  }
  return { headerOk: true, rows };
}

/** Parse a CSV blob into normalized rows. */
export function parseCsvRows(csv: string): ParseOutcome {
  const lines = csv.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length === 0 || !lines[0]?.trim()) {
    return { headerOk: false, rows: [] };
  }
  const header = parseCsvLine(lines[0] ?? '');
  const dataRows: Array<{ rowNumber: number; raw: string; cells: string[] }> = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (!raw.trim()) continue;
    dataRows.push({ rowNumber: i + 1, raw, cells: parseCsvLine(raw) });
  }
  return rowsFromTable(header, dataRows);
}
