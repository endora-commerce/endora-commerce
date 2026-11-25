import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Stage Task definition of a Template Stage — copied into the Project's
 * Stage (`ProjectStageTask`) and turned into a Task when the Project enters
 * the Stage (research R-7, R-8). At most 100 per Stage (R-22).
 */
@GlobalEntity()
@Entity({ tableName: 'project_template_stage_tasks' })
export class ProjectTemplateStageTask {
  [OptionalProps]?: 'id' | 'description' | 'responsibleRoleId' | 'dueOffsetDays';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  templateStageId!: string;

  @Property({ type: 'text' })
  title!: string;

  @Property({ type: 'text' })
  description: string = '';

  /** The Role whose single holder is assigned the Task; `null` for nobody. */
  @Property({ type: 'uuid', nullable: true })
  responsibleRoleId?: string | null;

  /** Due date = the Stage's start + this many days. */
  @Property({ type: 'integer' })
  dueOffsetDays: number = 0;

  @Property({ type: 'integer' })
  position!: number;
}
