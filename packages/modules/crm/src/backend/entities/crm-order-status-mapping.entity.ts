import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmOrderStatusMappingDirection = 'opportunity_to_order' | 'order_to_opportunity';

/**
 * One mapping between an Opportunity status and an Order status, in one
 * direction. `orderStatusCode` is an Order status code held by value — the
 * Order workflow is another module's and the operator's — and is re-validated
 * at use by the Orders port. Uniqueness is per direction, by two partial unique
 * indexes the migration creates: one Order status per Opportunity status going
 * forward, one Opportunity status per Order status coming back.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_order_status_mappings' })
export class CrmOrderStatusMapping {
  [OptionalProps]?: 'id' | 'requireAllOrders' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 24 })
  direction!: CrmOrderStatusMappingDirection;

  @Property({ type: 'string', length: 64 })
  opportunityStatusCode!: string;

  @Property({ type: 'string', length: 64 })
  orderStatusCode!: string;

  /** Meaningful for `order_to_opportunity` only. */
  @Property({ type: 'boolean' })
  requireAllOrders: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
