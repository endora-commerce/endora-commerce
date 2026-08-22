import { randomUUID } from 'node:crypto';
import type {
  BulkImportReport,
  BulkImportRowError,
  CatalogProductReadPort,
  InventoryStockImportPort,
  StockLevelImportRow,
} from '@endora-commerce/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { StockLevel } from '../entities/stock-level.entity.js';
import { DEFAULT_WAREHOUSE_ID } from '../entities/warehouse.entity.js';

/**
 * Bulk import of stock levels (feature 075, D-74).
 *
 * The counterpart of `catalog`'s bulk import, and it exists for the same three
 * reasons: the write is one Command and one audit row, validation runs before
 * anything is applied, and the whole run is all-or-nothing.
 *
 * Two things came back to this module with it. The rows are `stock_levels`, and
 * `import_export` was writing them while declaring a dependency on `catalog` and
 * `auth` only — an edge no check in the tree could see, because this module
 * ships the migration and that one ships none. And the seeded warehouse was
 * addressed by a **copy** of the deterministic UUID this module exports, pasted
 * into a function body; a duplicated constant is a coupling `check:module-boundary`
 * is structurally unable to report, since it reads import specifiers.
 *
 * The row carries no warehouse, which is the pre-existing contract of the CSV
 * path rather than a simplification taken here: foundation 001's sheet has no
 * warehouse column, so every row lands in the default warehouse. The
 * warehouse-scoped importer is `CsvStockImporter`, reached from this module's
 * own admin route.
 */
export class InventoryStockImportService implements InventoryStockImportPort {
  constructor(
    private readonly commandBus: CommandBus,
    /**
     * SKU → product id. A spreadsheet addresses a product the way an operator
     * does, so somebody has to ask `catalog`; doing it here is what lets the
     * rejected-row message ("unknown product_sku") be raised by the module that
     * knows the answer.
     */
    private readonly products: CatalogProductReadPort,
  ) {}

  async importStockLevels(rows: readonly StockLevelImportRow[]): Promise<BulkImportReport> {
    if (rows.length === 0) return { imported: 0, errors: [] };

    // Outside the Command: resolving a SKU is a read of another module, and it
    // does not belong inside this module's transaction.
    const products = await this.products.findBySkus(rows.map((row) => row.productSku));
    const idBySku = new Map(products.map((product) => [product.sku, product.id]));

    return this.commandBus.run<BulkImportReport>({
      action: 'inventory.stock_levels.import',
      objectType: 'stock_level',
      objectId: randomUUID(),
      run: async ({ em }) => {
        const errors: BulkImportRowError[] = [];
        for (const [index, row] of rows.entries()) {
          if (!idBySku.has(row.productSku)) {
            errors.push({ index, reason: `unknown product_sku: ${row.productSku}` });
          }
        }
        if (errors.length > 0) return { result: { imported: 0, errors }, skipAudit: true };

        const productIds = [...new Set(rows.map((row) => idBySku.get(row.productSku)!))];
        const levels = await em.find(StockLevel, {
          productId: { $in: productIds },
          warehouseId: DEFAULT_WAREHOUSE_ID,
        });
        const byKey = new Map(levels.map((level) => [levelKey(level.productId, level.variantId ?? null), level]));

        for (const row of rows) {
          const productId = idBySku.get(row.productSku)!;
          const variantId = row.variantId ?? null;
          const existing = byKey.get(levelKey(productId, variantId));
          if (existing) {
            existing.onHand = row.onHand;
            continue;
          }
          const created = em.create(StockLevel, {
            productId,
            ...(variantId !== null ? { variantId } : {}),
            warehouseId: DEFAULT_WAREHOUSE_ID,
            onHand: row.onHand,
          });
          // A second row for the same product and variant updates what the first
          // one created, rather than inserting a duplicate the partial-unique
          // index would refuse at flush.
          byKey.set(levelKey(productId, variantId), created);
        }
        await em.flush();

        return {
          result: { imported: rows.length, errors: [] },
          after: { rows: rows.length, warehouseId: DEFAULT_WAREHOUSE_ID },
        };
      },
    });
  }
}

/** `(productId, variantId)` as one map key; `null` is the simple-product baseline. */
function levelKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ''}`;
}
