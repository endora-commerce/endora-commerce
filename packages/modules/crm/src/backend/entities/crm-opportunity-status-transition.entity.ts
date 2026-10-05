import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A permitted directed edge `fromStatusCode → toStatusCode` in the Opportunity
 * workflow. Both ends reference `crm_opportunity_statuses.code` by value and
 * are validated in the service. A closing status may have outgoing edges:
 * reopening is a transition like any other.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_opportunity_status_transitions' })
@Unique({ properties: ['fromStatusCode', 'toStatusCode'] })
export class CrmOpportunityStatusTransition {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Index()
  fromStatusCode!: string;

  @Property({ type: 'string', length: 64 })
  toStatusCode!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
