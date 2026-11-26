import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { RecordReferenceType } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/** Which text of a Task a reference was read from. */
export type TaskReferenceSourceKind = 'description' | 'comment';

/**
 * One reference token a Task's description or comment holds (research R-5) —
 * who mentions what, refreshed inside the Command that saves the text. The
 * target is held by value: a reference to a record since gone renders as
 * unavailable. A database check lists the seven platform-wide target types.
 */
@RuleScoped()
@Entity({ tableName: 'task_references' })
@Index({ properties: ['targetType', 'targetId'] })
export class TaskReference {
  [OptionalProps]?: 'id' | 'sourceId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  taskId!: string;

  @Property({ type: 'string', length: 16 })
  sourceKind!: TaskReferenceSourceKind;

  /** The comment's id; `null` for the description. */
  @Property({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  @Property({ type: 'string', length: 32 })
  targetType!: RecordReferenceType;

  @Property({ type: 'uuid' })
  targetId!: string;
}
