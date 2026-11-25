import { ArrayType, OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Stage of a Template — the attributes of FR-010 a Project's Stage is
 * copied from (`ProjectStage`), without the dates a running Stage has.
 */
@GlobalEntity()
@Entity({ tableName: 'project_template_stages' })
export class ProjectTemplateStage {
  [OptionalProps]?:
    | 'id'
    | 'plannedDurationDays'
    | 'responsibleRoleIds'
    | 'alertOffsetsDays'
    | 'completionGate'
    | 'completionPermitted';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  templateId!: string;

  @Property({ type: 'text' })
  name!: string;

  /** `#rrggbb`. */
  @Property({ type: 'text' })
  color!: string;

  @Property({ type: 'integer' })
  position!: number;

  @Property({ type: 'integer' })
  plannedDurationDays: number = 0;

  @Property({ type: ArrayType, columnType: 'uuid[]' })
  responsibleRoleIds: string[] = [];

  /** Whole days before the deadline, each 1–365, each once. */
  @Property({ type: new ArrayType((value) => Number(value)), columnType: 'int[]' })
  alertOffsetsDays: number[] = [];

  @Property({ type: 'boolean' })
  completionGate: boolean = false;

  @Property({ type: 'boolean' })
  completionPermitted: boolean = false;
}
