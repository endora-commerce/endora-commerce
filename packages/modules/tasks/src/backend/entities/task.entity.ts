import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A Task — a piece of work for administrators, with a due moment and a status
 * (`specs/163-projects-and-tasks/data-model.md` §1, grown by
 * `specs/165-task-management/data-model.md` §1).
 *
 * **`@RuleScoped`, because its tenancy is its context's rule** (research R-9).
 * A Task carries no Organization of its own: a Task without a context is
 * visible to every holder of `tasks:read`, and a Task with one is visible
 * exactly when the module that registered its context type says the caller
 * may see the context. No ORM filter backs that — every read of this table
 * goes through `TaskVisibility` (`services/task-visibility.ts`), which is the
 * module's only read path.
 *
 * Feature 165 folds two flags into that one predicate (research R-3): a
 * **draft** is visible to its Creator only, a **private** Task to its Creator
 * and to holders of `tasks:see_private`.
 *
 * The context — `contextType` / `contextId` / `contextGroupId` — is opaque
 * here: `tasks` names no module that owns one. The creator is an administrator
 * held by value; the assignees are `task_assignees` rows (R-2). A status and a
 * priority are codes held by value (R-1, R-9).
 */
@RuleScoped()
@Entity({ tableName: 'tasks' })
export class Task {
  [OptionalProps]?:
    | 'id'
    | 'description'
    | 'status'
    | 'dueOn'
    | 'dueAt'
    | 'startOn'
    | 'priorityCode'
    | 'isDraft'
    | 'isPrivate'
    | 'parentTaskId'
    | 'sourceKey'
    | 'customFieldValues'
    | 'publishedAt'
    | 'completedAt'
    | 'contextType'
    | 'contextId'
    | 'contextGroupId'
    | 'contextNote'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `TSK-` + the zero-padded value of `tasks_number_seq`. */
  @Property({ type: 'text' })
  @Unique()
  number!: string;

  @Property({ type: 'text' })
  title!: string;

  /** Rich text — the `record-rich-text` subset — carrying reference tokens; never HTML. */
  @Property({ type: 'text' })
  description: string = '';

  /** A code of the configured workflow (`task_statuses.code`), held by value. */
  @Property({ type: 'text' })
  status: string = 'todo';

  /** With `dueAt`, its date in `tasks.time_zone`. */
  @Property({ type: 'date', nullable: true })
  dueOn?: string | null;

  /** A due moment; `dueOn` is derived from it (research R-17). */
  @Property({ type: 'datetime', nullable: true })
  dueAt?: Date | null;

  @Property({ type: 'date', nullable: true })
  startOn?: string | null;

  /** A code of `task_priorities`, held by value; `null` for none. */
  @Property({ type: 'text', nullable: true })
  priorityCode?: string | null;

  /** Visible to the Creator only until published (research R-3). */
  @Property({ type: 'boolean' })
  isDraft: boolean = false;

  /** Visible to the Creator and holders of `tasks:see_private`; never in a context. */
  @Property({ type: 'boolean' })
  isPrivate: boolean = false;

  /** The parent Task; `null` at the top level. Deleting the parent sets it null (R-15). */
  @Property({ type: 'uuid', nullable: true })
  parentTaskId?: string | null;

  /** The context owner's own key for a Task it created (R-19); unique per context. */
  @Property({ type: 'text', nullable: true })
  sourceKey?: string | null;

  /** The `task` custom-field host's value bag (R-8). */
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  /** Set at creation for a published Task, at publication for a draft. */
  @Property({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;

  /** Set on entering a `done`-category status, cleared on leaving it. */
  @Property({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Property({ type: 'uuid' })
  createdByAdminUserId!: string;

  /** The context's type, registered by its owner (`project`); `null` with no context. */
  @Property({ type: 'text', nullable: true })
  contextType?: string | null;

  @Property({ type: 'uuid', nullable: true })
  contextId?: string | null;

  /** A group inside the context — a Project's Stage. */
  @Property({ type: 'uuid', nullable: true })
  contextGroupId?: string | null;

  /** Written by the context's owner, e.g. "Responsible role: Installer". */
  @Property({ type: 'text', nullable: true })
  contextNote?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
