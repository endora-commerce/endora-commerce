import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * What an alert came to. `interrupted` is not a delivery's: a later pass sets
 * it on a claim left unsettled past `STAGE_ALERT_CLAIM_STALE_MS` (issue #462).
 */
export type ProjectStageAlertOutcome = 'bell' | 'bell_email' | 'email' | 'no_recipient' | 'undeliverable' | 'interrupted';

/**
 * One deadline alert of one Stage (research R-12): claimed before it is
 * delivered, settled after, once per (Stage, offset, deadline) — so a moved
 * deadline re-arms the alert and nothing is sent twice.
 */
@RuleScoped()
@Entity({ tableName: 'project_stage_alert_deliveries' })
export class ProjectStageAlertDelivery {
  [OptionalProps]?: 'id' | 'claimedAt' | 'outcome' | 'recipientCount' | 'settledAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  stageId!: string;

  @Property({ type: 'integer' })
  offsetDays!: number;

  /** `YYYY-MM-DD` — the deadline the alert was for. */
  @Property({ type: 'date' })
  deadlineOn!: string;

  @Property({ type: 'datetime' })
  claimedAt: Date = new Date();

  @Property({ type: 'text', nullable: true })
  outcome?: ProjectStageAlertOutcome | null;

  @Property({ type: 'integer', nullable: true })
  recipientCount?: number | null;

  @Property({ type: 'datetime', nullable: true })
  settledAt?: Date | null;
}
