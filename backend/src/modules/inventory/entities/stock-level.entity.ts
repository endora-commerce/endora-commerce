import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * StockLevel — onHand + reserved counters per
 * `(productId, variantId?, warehouseId)` triplet (feature 010).
 *
 * The unique-key shape changed in migration 030: previously the index
 * was on `(product_id, variant_id_bucket)`, now it includes
 * `warehouse_id` so multiple warehouses can hold the same product.
 * The partial-unique index lives in migration 030 (Postgres `coalesce`
 * trick on the variant column); this entity does not declare a
 * database-level unique constraint.
 */
@Entity({ tableName: 'stock_levels' })
export class StockLevel {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'variantId' | 'reserved';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  warehouseId!: string;

  @Property({ type: 'integer' })
  onHand!: number;

  @Property({ type: 'integer' })
  reserved: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
