/**
 * Minimal RFC 4180 CSV codec (Constitution Principle IV — no new dep).
 *
 * Handles quoted fields containing commas, double-quotes, and newlines.
 * Trades feature breadth for zero dependencies; if a real-world CSV
 * variant (e.g. semicolon delimiter, BOM marker, Excel quirks) appears in
 * traffic, that is the trigger to revisit and either extend this codec or
 * adopt a vetted library with a written justification per Principle IV.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip a leading UTF-8 BOM if Excel emitted one.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field.length === 0) {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // Swallow — the trailing \n closes the row.
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((r) => r.map(serializeField).join(',')).join('\n') + '\n';
}

function serializeField(value: string): string {
  if (
    value.includes('"') ||
    value.includes(',') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Converts a parsed CSV (header row + data rows) into an array of
 * string-keyed records. Throws on duplicate header keys.
 */
export function rowsToRecords(rows: string[][]): Array<Record<string, string>> {
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) {
      throw new Error(`duplicate header column: "${h}"`);
    }
    seen.add(h);
  }
  return rows.slice(1).map((row) => {
    const out: Record<string, string> = {};
    header.forEach((key, i) => {
      out[key] = row[i] ?? '';
    });
    return out;
  });
}
