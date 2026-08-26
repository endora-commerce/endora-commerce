import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * StockAllocation — one row per `(orderItemId, warehouseId)` pair
 * persisted at order placement so admins can see fulfilment
 * provenance per line and so cancellation can release reservations
 * cleanly (released_at is non-null after release).
 *
 * `is_backorder = true` when the allocation was made against a
 * product with `backorder_enabled = true` and the chosen warehouse
 * could not satisfy the full quantity at order time.
 */
@GlobalEntity()
@Entity({ tableName: 'stock_allocations' })
@Unique({ properties: ['orderItemId', 'warehouseId'] })
export class StockAllocation {
  [OptionalProps]?: 'id' | 'createdAt' | 'releasedAt' | 'isBackorder';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderItemId!: string;

  @Property({ type: 'uuid' })
  @Index()
  warehouseId!: string;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'boolean' })
  isBackorder: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  releasedAt?: Date | null;
}
