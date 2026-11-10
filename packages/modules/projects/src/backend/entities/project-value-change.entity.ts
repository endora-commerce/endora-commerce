import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * What one write changed among a Project's values, with the values (task T145,
 * issue #470): the platform audit log names the changed fields only (T144 F4),
 * the Project's history shows them from here. Written in the Command of the
 * change; the audit entry carries this row's id as `valueChangeId`. Read only
 * by the id of a Project `ProjectAccess` handed out.
 */
@RuleScoped()
@Entity({ tableName: 'project_value_changes' })
export class ProjectValueChange {
  [OptionalProps]?: 'id' | 'before' | 'at';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  projectId!: string;

  /** `null` for a create. */
  @Property({ type: 'json', nullable: true })
  before?: ProjectValueState | null;

  @Property({ type: 'json' })
  after!: ProjectValueState;

  @Property({ type: 'datetime' })
  at: Date = new Date();
}

/** The changed values of one side of a write — only the keys that changed. */
export interface ProjectValueState {
  /** Owner ruling O-1 (2026-11-10, #470): a title is a value. */
  title?: string | null;
  valueAmount?: string | null;
  valueCurrency?: string | null;
  customFieldValues?: Record<string, unknown>;
}
