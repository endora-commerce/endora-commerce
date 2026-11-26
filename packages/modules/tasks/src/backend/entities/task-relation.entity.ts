import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * Two related Tasks (research R-15), stored once with the smaller id first —
 * a database check holds `taskAId < taskBId` — and shown on both.
 */
@RuleScoped()
@Entity({ tableName: 'task_relations' })
export class TaskRelation {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  taskAId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index()
  taskBId!: string;

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
