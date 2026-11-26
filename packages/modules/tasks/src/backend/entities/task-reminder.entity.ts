import { ArrayType, OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type TaskReminderMode = 'absolute' | 'relative';

/**
 * A reminder on a Task (research R-17): at a moment, or some minutes before the
 * due moment — then `remindAt` is recomputed in the Command that moves the due
 * moment. Delivered once per recipient by the `tasks-reminders` sweep.
 */
@RuleScoped()
@Entity({ tableName: 'task_reminders' })
export class TaskReminder {
  [OptionalProps]?: 'id' | 'offsetMinutes' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  taskId!: string;

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  @Property({ type: 'string', length: 16 })
  mode!: TaskReminderMode;

  @Property({ type: 'datetime' })
  @Index()
  remindAt!: Date;

  /** Relative reminders only. */
  @Property({ type: 'integer', nullable: true })
  offsetMinutes?: number | null;

  /** 1–21: the reminder's creator and up to twenty assignees. */
  @Property({ type: ArrayType, columnType: 'uuid[]' })
  recipientAdminUserIds: string[] = [];

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
