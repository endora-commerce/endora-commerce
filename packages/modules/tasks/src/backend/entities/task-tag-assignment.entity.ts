import { Entity, Index, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * A tag a Task carries (research R-10) — a composite key cascading from both
 * the Task and the tag. Which tags a Task carries is the Task's information,
 * so it is rule-scoped as the Task is, though the tag itself is global.
 */
@RuleScoped()
@Entity({ tableName: 'task_tag_assignments' })
export class TaskTagAssignment {
  @PrimaryKey({ type: 'uuid' })
  taskId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index()
  tagId!: string;
}
