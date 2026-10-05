import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmStatusChangeCause = 'manual' | 'order_status' | 'system' | 'created';

/**
 * One status change of an Opportunity, append-only. A row is written at
 * creation too (`fromStatusCode = null`, `cause = 'created'`), so the time
 * spent in the start status is measurable.
 *
 * This is the analytics source — per-status intervals as rows. The change
 * history an operator reads is the audit log, not this table.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_status_history' })
@Index({ properties: ['opportunityId', 'changedAt'] })
export class CrmOpportunityStatusHistory {
  [OptionalProps]?:
    | 'id'
    | 'fromStatusCode'
    | 'changedAt'
    | 'actorAdminUserId'
    | 'causeOrderId'
    | 'reason';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  opportunityId!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  fromStatusCode?: string | null;

  @Property({ type: 'string', length: 64 })
  @Index()
  toStatusCode!: string;

  @Property({ type: 'datetime' })
  @Index()
  changedAt: Date = new Date();

  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId?: string | null;

  @Property({ type: 'string', length: 16 })
  cause!: CrmStatusChangeCause;

  /** Set when `cause = 'order_status'`. */
  @Property({ type: 'uuid', nullable: true })
  causeOrderId?: string | null;

  @Property({ type: 'text', nullable: true })
  reason?: string | null;
}
