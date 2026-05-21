import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Per-(product, warehouse) low-stock threshold. Consulted only when the
 * referenced Product is in `low_stock_threshold_mode = 'per_warehouse'`.
 *
 * Composite primary key `(product_id, warehouse_id)` ensures one row per
 * pair. Both FKs cascade-delete with their parent.
 */
@Entity({ tableName: 'product_warehouse_low_stock_thresholds' })
export class ProductWarehouseLowStockThreshold {
  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'uuid' })
  warehouseId!: string;

  @Property({ type: 'integer' })
  threshold!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
