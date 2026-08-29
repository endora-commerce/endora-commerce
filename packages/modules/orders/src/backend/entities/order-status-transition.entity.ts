import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * OrderStatusTransition — feature 038 (configurable lifecycle, US1).
 *
 * A permitted directed edge `fromStatusCode → toStatusCode` in the lifecycle
 * graph. Endpoints reference `order_statuses.code` by value (validated
 * in-service, not a hard FK, so a status rename does not cascade). `isSystem`
 * marks the universal on_hold/cancelled edges materialized at seed time.
 */
@GlobalEntity()
@Entity({ tableName: 'order_status_transitions' })
@Unique({ properties: ['fromStatusCode', 'toStatusCode'] })
export class OrderStatusTransition {
  [OptionalProps]?: 'id' | 'isSystem' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Index()
  fromStatusCode!: string;

  @Property({ type: 'string', length: 64 })
  toStatusCode!: string;

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
