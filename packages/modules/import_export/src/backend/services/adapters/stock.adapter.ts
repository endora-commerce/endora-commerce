import type { BulkImportReport, BulkImportRowError, StockLevelImportRow } from '@endora-commerce/contracts';
import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

/**
 * Stock levels import/export. Reservations are read-only — operators only
 * edit `on_hand`. The variant column is optional; an empty value addresses
 * the simple-product baseline level.
 *
 * Feature 075 / D-74 — this adapter used to write `inventory`'s `stock_levels`
 * while this module declared `catalog` and `auth` as its only dependencies, and
 * it addressed the seeded warehouse by a **copy** of `inventory`'s
 * deterministic UUID pasted into the function body. Both go with the write: the
 * rows belong to `inventory`, so `inventory` applies them, and the row a caller
 * passes names a SKU and a quantity because that is all a spreadsheet knows.
 */
export function stockAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'stock',
    owners: ['inventory', 'catalog'],
    exportHeader: ['product_sku', 'variant_id', 'on_hand', 'reserved'] as const,

    async exportRows(): Promise<string[][]> {
      // The SKU is `catalog`'s and the level is `inventory`'s, so the export is
      // two reads and a join here rather than one module knowing the other's
      // table. A level whose product does not resolve is dropped, exactly as it
      // was when the join was a `Map` over an entity query.
      const products = await ports.catalogProducts.listAll();
      if (products.length === 0) return [];
      const skuByProductId = new Map(products.map((p) => [p.id, p.sku]));
      const levels = await ports.inventoryStock.listStockForProducts([...skuByProductId.keys()]);
      return levels
        .map<[string, string, string, string] | null>((l) => {
          const sku = skuByProductId.get(l.productId);
          if (!sku) return null;
          return [sku, l.variantId ?? '', String(l.onHand), String(l.reserved)];
        })
        .filter((row): row is [string, string, string, string] => row !== null);
    },

    importHeader: ['product_sku', 'variant_id', 'on_hand'] as const,

    async importRows(records): Promise<BulkImportReport> {
      const errors: BulkImportRowError[] = [];
      const rows: StockLevelImportRow[] = [];

      for (const [index, record] of records.entries()) {
        const productSku = record['product_sku']?.trim();
        if (!productSku) {
          errors.push({ index, reason: 'product_sku is required' });
          continue;
        }

        const onHandRaw = record['on_hand']?.trim();
        const onHand = onHandRaw ? Number.parseInt(onHandRaw, 10) : NaN;
        if (Number.isNaN(onHand) || onHand < 0) {
          errors.push({ index, reason: `invalid on_hand: ${onHandRaw}` });
          continue;
        }

        const variantId = record['variant_id']?.trim() || null;
        rows.push({ productSku, variantId, onHand });
      }

      if (errors.length > 0) return { imported: 0, errors };
      return ports.inventoryStockImport.importStockLevels(rows);
    },
  };
}
