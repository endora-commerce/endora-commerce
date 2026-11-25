import { ArrayType, OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { ProjectStageEntryKind, ProjectStageEntryNote } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * One row of a Project's Stage history (research R-5): an entry, a close or a
 * reopen, with the Stage names **as they were** — analytics group by name, and
 * a Stage renamed or deleted later does not rewrite its past. The Stage ids
 * are values, not keys.
 */
@RuleScoped()
@Entity({ tableName: 'project_stage_entries' })
export class ProjectStageEntry {
  [OptionalProps]?:
    | 'id'
    | 'fromStageId'
    | 'toStageId'
    | 'fromStageName'
    | 'toStageName'
    | 'notes'
    | 'actorAdminUserId'
    | 'at';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  /** `null` at creation. */
  @Property({ type: 'uuid', nullable: true })
  fromStageId?: string | null;

  /** `null` when the row records a close. */
  @Property({ type: 'uuid', nullable: true })
  toStageId?: string | null;

  @Property({ type: 'text' })
  kind!: ProjectStageEntryKind;

  @Property({ type: 'text', nullable: true })
  fromStageName?: string | null;

  @Property({ type: 'text', nullable: true })
  toStageName?: string | null;

  @Property({ type: ArrayType, columnType: 'text[]' })
  notes: ProjectStageEntryNote[] = [];

  /** `null` for the system. */
  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId?: string | null;

  @Property({ type: 'datetime' })
  at: Date = new Date();
}
