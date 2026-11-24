import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import type { ProjectState, ProjectVisibility } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Project — work for zero or more Organizations, run through its own Stages
 * by Members holding Project Roles (`specs/163-projects-and-tasks/data-model.md`
 * §2.2).
 *
 * **`@RuleScoped`, and no ORM filter backs it** (research R-2). A Project of
 * several Organizations is visible only to an administrator who reaches every
 * one of them; one of none, only to an administrator unrestricted in reach;
 * and then only if the visibility rule (R-3) lets them. Every read of this
 * table, and of every table a Project owns, goes through `ProjectAccess`
 * (`services/project-access.ts`) — `project-access-seam.test.ts` refuses any
 * other.
 *
 * An open Project always has a current Stage (a deferred constraint trigger,
 * checked at commit). `version` is the optimistic-concurrency token of moves,
 * closes and edits; `configurationVersion` that of the Project's sets, and each
 * Stage carries its own (issue #449).
 */
@RuleScoped()
@Entity({ tableName: 'projects' })
export class Project {
  [OptionalProps]?:
    | 'id'
    | 'description'
    | 'valueAmount'
    | 'valueCurrency'
    | 'startOn'
    | 'state'
    | 'currentStageId'
    | 'closedAt'
    | 'lostStageId'
    | 'lossReasonId'
    | 'lossComment'
    | 'visibility'
    | 'templateId'
    | 'customFieldValues'
    | 'version'
    | 'configurationVersion'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `PRJ-` + the zero-padded value of `projects_number_seq`. */
  @Property({ type: 'text' })
  @Unique()
  number!: string;

  @Property({ type: 'text' })
  title!: string;

  /** Plain text carrying reference tokens; never HTML. */
  @Property({ type: 'text' })
  description: string = '';

  /** `numeric(18,2)` as a decimal string; set with its currency or not at all. */
  @Property({ type: 'decimal', columnType: 'numeric(18,2)', nullable: true })
  valueAmount?: string | null;

  @Property({ type: 'character', columnType: 'char(3)', nullable: true })
  valueCurrency?: string | null;

  /** `YYYY-MM-DD`. */
  @Property({ type: 'date' })
  startOn?: string;

  @Property({ type: 'text' })
  state: ProjectState = 'open';

  @Property({ type: 'uuid', nullable: true })
  currentStageId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  closedAt?: Date | null;

  /** The Stage a lost Project was lost in. */
  @Property({ type: 'uuid', nullable: true })
  lostStageId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  lossReasonId?: string | null;

  @Property({ type: 'text', nullable: true })
  lossComment?: string | null;

  @Property({ type: 'text' })
  visibility: ProjectVisibility = 'inherit';

  /** The Template the Project was created from — provenance only (R-7). */
  @Property({ type: 'uuid', nullable: true })
  templateId?: string | null;

  /** Operator-defined fields (research R-18), validated by `custom_fields`. */
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  @Property({ type: 'integer' })
  version: number = 1;

  /**
   * The optimistic-concurrency token of the Project's sets — its Stages added,
   * deleted and reordered, its workflow, its Organizations and its Members
   * (issue #449); each of them moves it, and none of them moves `version`.
   */
  @Property({ type: 'integer' })
  configurationVersion: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
