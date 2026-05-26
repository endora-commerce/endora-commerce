import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../catalog/entities/product.entity.js';

/**
 * QuickOrderCsvImporter (T203). Parses a CSV blob with `sku` and
 * `quantity` columns (header row is required), looks up each row's
 * product in the catalog, and partitions rows into recognised + rejected
 * with line numbers preserved so the UI can highlight problem rows.
 *
 * Lenience:
 *   - whitespace + double-quoted fields are stripped
 *   - column headers can appear in any order
 *   - blank lines + trailing whitespace are skipped silently
 *
 * Strictness:
 *   - missing SKU → 'sku_missing'
 *   - non-positive integer qty → 'quantity_invalid'
 *   - SKU not found → 'product_not_found'
 *   - product archived → 'product_archived'
 *   - row with too few cells → 'malformed_row'
 */

export interface RecognizedRow {
  line: number;
  sku: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface RejectedRow {
  line: number;
  raw: string;
  reason:
    | 'sku_missing'
    | 'quantity_invalid'
    | 'product_not_found'
    | 'product_archived'
    | 'malformed_row';
}

export interface ImportResult {
  recognized: RecognizedRow[];
  rejected: RejectedRow[];
}

export class QuickOrderCsvImporter {
  constructor(private readonly emFactory: () => EntityManager) {}

  async import(csv: string): Promise<ImportResult> {
    const lines = csv.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length === 0 || !lines[0]?.trim()) {
      return { recognized: [], rejected: [] };
    }
    const header = parseRow(lines[0] ?? '').map((c) => c.toLowerCase());
    const skuIdx = header.indexOf('sku');
    const qtyIdx = header.indexOf('quantity');
    if (skuIdx === -1 || qtyIdx === -1) {
      // No usable header — every data row is malformed.
      const rejected: RejectedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        if (!raw.trim()) continue;
        rejected.push({ line: i + 1, raw, reason: 'malformed_row' });
      }
      return { recognized: [], rejected };
    }

    const candidates: Array<{ line: number; sku: string; quantity: number; raw: string }> = [];
    const rejected: RejectedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      if (!raw.trim()) continue;
      const cells = parseRow(raw);
      if (cells.length < Math.max(skuIdx, qtyIdx) + 1) {
        rejected.push({ line: i + 1, raw, reason: 'malformed_row' });
        continue;
      }
      const sku = (cells[skuIdx] ?? '').trim();
      const qtyRaw = (cells[qtyIdx] ?? '').trim();
      if (!sku) {
        rejected.push({ line: i + 1, raw, reason: 'sku_missing' });
        continue;
      }
      const quantity = Number.parseInt(qtyRaw, 10);
      if (!Number.isFinite(quantity) || quantity < 1 || String(quantity) !== qtyRaw) {
        rejected.push({ line: i + 1, raw, reason: 'quantity_invalid' });
        continue;
      }
      candidates.push({ line: i + 1, sku, quantity, raw });
    }

    if (candidates.length === 0) return { recognized: [], rejected };

    const em = this.emFactory();
    const skus = Array.from(new Set(candidates.map((c) => c.sku)));
    const products = await em.find(Product, { sku: { $in: skus } });
    const bySku = new Map(products.map((p) => [p.sku, p]));

    const recognized: RecognizedRow[] = [];
    for (const row of candidates) {
      const product = bySku.get(row.sku);
      if (!product) {
        rejected.push({ line: row.line, raw: row.raw, reason: 'product_not_found' });
        continue;
      }
      if (product.status === 'inactive' || product.deletedAt) {
        rejected.push({ line: row.line, raw: row.raw, reason: 'product_archived' });
        continue;
      }
      recognized.push({
        line: row.line,
        sku: product.sku,
        productId: product.id,
        variantId: null,
        quantity: row.quantity,
      });
    }
    return { recognized, rejected };
  }
}

/**
 * Minimal CSV row parser — handles double-quoted fields with embedded
 * commas and escaped quotes (`""`). Sufficient for the quick-order use
 * case; full RFC 4180 escapes are out of scope.
 */
function parseRow(line: string): string[] {
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
    } else {
      if (ch === ',') {
        cells.push(current);
        current = '';
      } else if (ch === '"' && current.length === 0) {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells;
}
