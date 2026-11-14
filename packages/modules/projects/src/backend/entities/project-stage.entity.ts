import { ArrayType, Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Stage of one Project (research R-5): its attributes (FR-010) and, once
 * entered, its start date and deadline (FR-013). Stage names are plain text —
 * operator content, written once per Project, not translated. Positions are
 * unique within the Project, checked at commit so a reorder can swap them.
 */
@RuleScoped()
@Entity({ tableName: 'project_stages' })
export class ProjectStage {
  [OptionalProps]?:
    | 'id'
    | 'plannedDurationDays'
    | 'responsibleRoleIds'
    | 'alertOffsetsDays'
    | 'completionGate'
    | 'completionPermitted'
    | 'startedOn'
    | 'deadlineOn'
    | 'deadlineManual'
    | 'tasksMaterializedAt'
    | 'tasksSkippedAt'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

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

  /** `YYYY-MM-DD`, set on entry in the alerts time zone. */
  @Property({ type: 'date', nullable: true })
  startedOn?: string | null;

  /** `YYYY-MM-DD` — computed as start + duration, or set by hand. */
  @Property({ type: 'date', nullable: true })
  deadlineOn?: string | null;

  @Property({ type: 'boolean' })
  deadlineManual: boolean = false;

  /** Stage Tasks were created on entry (R-8) — terminal. */
  @Property({ type: 'datetime', nullable: true })
  tasksMaterializedAt?: Date | null;

  /** Stage Tasks were skipped on entry, Tasks being off (R-8) — terminal. */
  @Property({ type: 'datetime', nullable: true })
  tasksSkippedAt?: Date | null;

  /**
   * The optimistic-concurrency token of the Stage's own edits — its attributes
   * and its Stage Task definitions (issue #449); each of them moves it.
   */
  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
