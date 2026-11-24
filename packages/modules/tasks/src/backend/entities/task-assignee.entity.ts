import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * One assignee of a Task (`specs/165-task-management/` research R-2). At most
 * `TASK_ASSIGNEES_MAX` (20) per Task, checked by the service. Rule-scoped as
 * its Task is: read only through `TaskVisibility`, never on its own.
 */
@RuleScoped()
@Entity({ tableName: 'task_assignees' })
export class TaskAssignee {
  [OptionalProps]?: 'assignedAt' | 'assignedByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  taskId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index()
  adminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  assignedAt: Date = new Date();

  /** `null` for an assignee the upgrade copied from 163, or one a module's port named. */
  @Property({ type: 'uuid', nullable: true })
  assignedByAdminUserId?: string | null;
}
