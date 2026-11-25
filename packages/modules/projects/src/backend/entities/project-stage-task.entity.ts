import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Stage Task definition of a Project's own Stage (research R-7) — becomes a
 * Task when the Project enters the Stage, through `tasks`' write port.
 */
@RuleScoped()
@Entity({ tableName: 'project_stage_tasks' })
export class ProjectStageTask {
  [OptionalProps]?: 'id' | 'description' | 'responsibleRoleId' | 'dueOffsetDays';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  stageId!: string;

  @Property({ type: 'text' })
  title!: string;

  @Property({ type: 'text' })
  description: string = '';

  @Property({ type: 'uuid', nullable: true })
  responsibleRoleId?: string | null;

  /** Due date = the Stage's start + this many days. */
  @Property({ type: 'integer' })
  dueOffsetDays: number = 0;

  @Property({ type: 'integer' })
  position!: number;
}
