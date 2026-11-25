import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A comment on a Task (research R-6) — Projects' note without a `kind`. Edited
 * and deleted by its author only; a deleted comment keeps its row, empty, so
 * the thread shows that it was. The body is rich text carrying reference tokens.
 */
@RuleScoped()
@Entity({ tableName: 'task_comments' })
@Index({ properties: ['taskId', 'createdAt'] })
export class TaskComment {
  [OptionalProps]?: 'id' | 'editedAt' | 'deletedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  taskId!: string;

  @Property({ type: 'text' })
  body!: string;

  @Property({ type: 'uuid' })
  authorAdminUserId!: string;

  @Property({ type: 'datetime', nullable: true })
  editedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
