import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { CrmOrderStatusMappingDirection } from './crm-order-status-mapping.entity.js';

export type CrmPropagationOutcome =
  | 'pending'
  | 'applied'
  | 'already_there'
  | 'not_found'
  | 'unknown_status'
  | 'not_permitted'
  | 'vetoed'
  | 'skipped'
  | 'failed';

/**
 * One attempt to carry a status across the Opportunity ↔ Order link, and what
 * became of it.
 *
 * A forward row is written `pending` **before** the Orders port is called and
 * resolved after it, so a crash between the Opportunity's commit and the call
 * leaves evidence a retry can consume; the same row is the echo marker the
 * reverse direction uses to recognise a change as CRM's own (`echoed`).
 * `skipped` is reverse-direction only. A retry inserts a new row and sets
 * `dismissedAt` on the old one.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_status_propagations' })
@Index({ properties: ['opportunityId', 'createdAt'] })
@Index({ properties: ['orderId', 'direction', 'outcome'] })
export class CrmStatusPropagation {
  [OptionalProps]?:
    | 'id'
    | 'outcome'
    | 'detail'
    | 'echoed'
    | 'dismissedAt'
    | 'statusHistoryId'
    | 'createdAt'
    | 'resolvedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  opportunityId!: string;

  /** The Order, by value. */
  @Property({ type: 'uuid' })
  orderId!: string;

  @Property({ type: 'string', length: 24 })
  direction!: CrmOrderStatusMappingDirection;

  @Property({ type: 'string', length: 64 })
  opportunityStatusCode!: string;

  /** The Order status requested (forward) or observed (reverse). */
  @Property({ type: 'string', length: 64 })
  orderStatusCode!: string;

  @Property({ type: 'string', length: 16 })
  outcome: CrmPropagationOutcome = 'pending';

  /** The port's `detail`, or CRM's reason for `skipped`. */
  @Property({ type: 'text', nullable: true })
  detail?: string | null;

  @Property({ type: 'boolean' })
  echoed: boolean = false;

  /** A user acknowledged a refusal. */
  @Property({ type: 'datetime', nullable: true })
  dismissedAt?: Date | null;

  /** The status change that caused it. */
  @Property({ type: 'uuid', nullable: true })
  statusHistoryId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  resolvedAt?: Date | null;
}
