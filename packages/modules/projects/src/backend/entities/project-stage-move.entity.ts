import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/** A permitted move between two Stages of one Project (FR-011). */
@RuleScoped()
@Entity({ tableName: 'project_stage_moves' })
export class ProjectStageMove {
  @PrimaryKey({ type: 'uuid' })
  fromStageId!: string;

  @PrimaryKey({ type: 'uuid' })
  toStageId!: string;

  @Property({ type: 'uuid' })
  projectId!: string;
}
