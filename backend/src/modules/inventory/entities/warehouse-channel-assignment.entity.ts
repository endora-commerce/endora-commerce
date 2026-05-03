import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * WarehouseChannelAssignment — m:n binding between warehouses and
 * sales channels with at most one default per channel (enforced by a
 * partial unique index on `(sales_channel_id) WHERE is_default = true`
 * in migration 030).
 */
@Entity({ tableName: 'warehouse_channel_assignments' })
@Unique({ properties: ['warehouseId', 'salesChannelId'] })
export class WarehouseChannelAssignment {
  [OptionalProps]?: 'id' | 'createdAt' | 'isDefault' | 'sortOrder';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  warehouseId!: string;

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
