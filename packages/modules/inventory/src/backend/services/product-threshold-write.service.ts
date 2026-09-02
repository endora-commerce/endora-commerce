import type {
  InventoryProductThresholdWritePort,
  ProductThresholdCopyResult,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ProductWarehouseLowStockThreshold } from '../entities/product-warehouse-low-stock-threshold.entity.js';

/**
 * The per-warehouse threshold copy this module publishes (issue #185).
 *
 * `catalog`'s `duplicateProduct` used to write these rows itself:
 *
 * ```
 * insert into "product_warehouse_low_stock_thresholds"
 *   ("product_id", "warehouse_id", "threshold", "created_at", "updated_at")
 *   select ?, "warehouse_id", "threshold", now(), now()
 *     from "product_warehouse_low_stock_thresholds" where "product_id" = ?
 * ```
 *
 * — on `catalog`'s `EntityManager`, after its `CommandBus.run` had already
 * returned, with this module's activation state never consulted. It is the same
 * shape D-74 took off `import_export` for `stock_levels`, and it comes back for
 * the same three reasons: the write is one Command and one audit row, it is
 * gated by the module that owns the rows, and the caller stops needing to know
 * the table's columns.
 *
 * **Its own transaction, deliberately.** `duplicateProduct` commits the product
 * row first and then copies each bridge — the code says so at the seam and has
 * since feature 054 ("a partially-copied dup is no worse than today"). Nothing
 * here can be co-transactional with a transaction that has already committed,
 * and nothing should want to be: a duplicate without per-warehouse thresholds
 * falls back to the product-level and warehouse-level chain, which is precisely
 * what a duplicate looks like on a deployment that never installed this module.
 */
export class InventoryProductThresholdWriteService
  implements InventoryProductThresholdWritePort
{
  constructor(private readonly commandBus: CommandBus) {}

  async copyProductWarehouseThresholds(input: {
    sourceProductId: string;
    targetProductId: string;
  }): Promise<ProductThresholdCopyResult> {
    return this.commandBus.run<ProductThresholdCopyResult>({
      action: 'inventory.product_thresholds.copy',
      objectType: 'product_warehouse_low_stock_threshold',
      objectId: input.targetProductId,
      run: async ({ em }) => {
        const source = await em.find(ProductWarehouseLowStockThreshold, {
          productId: input.sourceProductId,
        });
        if (source.length === 0) {
          // Nothing changed state, so nothing is recorded — the rule
          // `SalesChannelMembershipService` applies to an idempotent add.
          return { result: { copied: 0 }, skipAudit: true };
        }

        const existing = await em.find(ProductWarehouseLowStockThreshold, {
          productId: input.targetProductId,
          warehouseId: { $in: source.map((row) => row.warehouseId) },
        });
        const byWarehouse = new Map(existing.map((row) => [row.warehouseId, row]));

        for (const row of source) {
          const target = byWarehouse.get(row.warehouseId);
          if (target) {
            target.threshold = row.threshold;
            continue;
          }
          em.persist(
            em.create(ProductWarehouseLowStockThreshold, {
              productId: input.targetProductId,
              warehouseId: row.warehouseId,
              threshold: row.threshold,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          );
        }
        await em.flush();

        return {
          result: { copied: source.length },
          after: {
            sourceProductId: input.sourceProductId,
            targetProductId: input.targetProductId,
            copied: source.length,
          },
        };
      },
    });
  }
}
