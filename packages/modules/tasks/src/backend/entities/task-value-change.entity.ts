import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * What one Command changed among a Task's values, with the values (issue #470,
 * D-288; `specs/conventions/audit-state.md` §3).
 *
 * The platform audit log is not tenant-scoped, so a `tasks.*` audit entry
 * names the fields a write changed (`changedFields`, `changedCustomFields`)
 * and carries this row's id as `valueChangeId`; the Task's history serves the
 * values from here. Written in the Command of the change, so the row and the
 * audit entry commit or roll back together. Classified like the Task, and read
 * only by the id of a Task the reader may see.
 *
 * `before` is `null` for something that only arrived (a creation, an
 * attachment), `after` for something that went. Each side holds only the keys
 * that changed.
 */
@RuleScoped()
@Entity({ tableName: 'task_value_changes' })
export class TaskValueChange {
  [OptionalProps]?: 'id' | 'before' | 'after' | 'at';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  taskId!: string;

  @Property({ type: 'json', nullable: true })
  before?: TaskValueState | null = null;

  @Property({ type: 'json', nullable: true })
  after?: TaskValueState | null = null;

  @Property({ type: 'datetime' })
  at: Date = new Date();
}

/** The changed values of one side of a write — only the keys that changed. */
export type TaskValueState = Record<string, unknown>;
