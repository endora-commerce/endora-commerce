import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/** What the sweep did for one recipient of one reminder. */
export type TaskReminderOutcome = 'delivered' | 'expired' | 'skipped';

/**
 * One recipient's handling of one reminder (research R-17) — the claim: the
 * unique `(reminderId, adminUserId)` key is what makes a reminder reach a
 * recipient once. `skipped` covers a recipient who may no longer see the Task,
 * or a Task that is closed or a draft. Bookkeeping, not a domain write.
 */
@RuleScoped()
@Entity({ tableName: 'task_reminder_deliveries' })
@Unique({ properties: ['reminderId', 'adminUserId'] })
export class TaskReminderDelivery {
  [OptionalProps]?: 'id' | 'recordedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  reminderId!: string;

  @Property({ type: 'uuid' })
  adminUserId!: string;

  @Property({ type: 'string', length: 16 })
  outcome!: TaskReminderOutcome;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  recordedAt: Date = new Date();
}
