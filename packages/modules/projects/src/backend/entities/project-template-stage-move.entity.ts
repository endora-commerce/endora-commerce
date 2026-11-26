import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** A permitted move between two Stages of one Template (FR-011). */
@GlobalEntity()
@Entity({ tableName: 'project_template_stage_moves' })
export class ProjectTemplateStageMove {
  @PrimaryKey({ type: 'uuid' })
  fromStageId!: string;

  @PrimaryKey({ type: 'uuid' })
  toStageId!: string;

  @Property({ type: 'uuid' })
  templateId!: string;
}
