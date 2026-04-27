import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * DeliveryMethod — a configurable shipping option (courier, pickup, pallet).
 * Referenced by Order at creation time; the cost is captured as a snapshot
 * on the Order so later changes to this row do not rewrite history.
 */
@Entity({ tableName: 'delivery_methods' })
export class DeliveryMethod {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'status' | 'cost';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  cost: string = '0';

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
