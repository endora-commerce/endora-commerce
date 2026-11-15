import type { EntityManager } from '@mikro-orm/postgresql';
import { isDeepStrictEqual } from 'util';
import type { Project } from '../entities/project.entity.js';
import type { ProjectStage } from '../entities/project-stage.entity.js';
import type { ProjectStageTask } from '../entities/project-stage-task.entity.js';
import { ProjectValueChange, type ProjectValueState } from '../entities/project-value-change.entity.js';

/**
 * What a `projects.project.*` audit entry may say, and where the rest goes
 * (D-288, `specs/conventions/audit-state.md`; owner rulings O-1 and O-4;
 * issues #470 and #1226).
 *
 * The platform audit log is one global table read under `audit_log:read`
 * without Organization reach, and a Project and everything hanging on it —
 * its Stages, their task definitions, its attachments — are `@RuleScoped`. So
 * an entry carries **names and structure**: numbers, codes, ids, positions,
 * dates, booleans, counts and lengths, and the names of what changed. A
 * Project's title and value, its custom-field values, a Stage's name, a task
 * definition's title and a file's name go to `project_value_changes` instead,
 * written in the same Command; the entry carries that row's id as
 * `valueChangeId`, and the Project's change history serves the values from it
 * (`history-service.ts`). Entries written before this rule are served as they
 * are stored (O-4).
 */

/**
 * Every top-level key a `projects.project.*` Command may put in an audit
 * state, and the keys of a task definition nested under `tasks`. Anything else is a value until somebody classifies it on purpose —
 * `project-audit-state.test.ts` holds the snapshots to this list, and
 * `backend/test/integration/projects/audit-sentinels.test.ts` holds every
 * Command's recorded state to it.
 */
export const PROJECTS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // The Project: its number, codes, a date, a length and its version.
  'number',
  'state',
  'startOn',
  'visibility',
  'descriptionLength',
  'version',
  'templateId',
  // Who and what it is for, by id.
  'organizationId',
  'organizationIds',
  'members',
  'viewerIds',
  // What changed, by name, and where the values are.
  'changedFields',
  'changedCustomFields',
  'valueChangeId',
  // Its Stages, by id and position, and their own codes, counts and dates;
  // `color` is a `#rrggbb` code, never free text.
  'stageId',
  'stageIds',
  'color',
  'position',
  'plannedDurationDays',
  'responsibleRoleIds',
  'alertOffsetsDays',
  'completionGate',
  'completionPermitted',
  'startedOn',
  'deadlineOn',
  'deadlineManual',
  // The workflow, a Stage's task definitions by position (each a role id, a
  // day count, a length and its position), a Stage entry.
  'moves',
  'tasks',
  'responsibleRoleId',
  'dueOffsetDays',
  'entryId',
  'notes',
  'note',
  // Closing: the loss reason by code, the comment by length.
  'lossReasonCode',
  'lossCommentLength',
  // Notes and messages: by id, kind and length.
  'commentId',
  'kind',
  'authorAdminUserId',
  'length',
  'deleted',
  // A linked record: its kind and ids.
  'linkId',
  'recordKind',
  'recordId',
  // An attachment: the row and the library file, by id.
  'attachmentId',
  'assetId',
]);

/**
 * The audit snapshot of a Project: the description by its length only, and
 * neither the title (O-1), the value nor the custom-field values — a write
 * says *that* they changed, never what to (T144 F4); the values go to the
 * Project's own store (T145).
 */
export function projectSnapshot(project: Project): Record<string, unknown> {
  return {
    number: project.number,
    state: project.state,
    startOn: project.startOn ?? null,
    visibility: project.visibility,
    descriptionLength: project.description.length,
    version: project.version,
  };
}

/** The audit snapshot of a Stage: by id and position; its name is a value (#1226). */
export function stageSnapshot(stage: ProjectStage): Record<string, unknown> {
  return {
    stageId: stage.id,
    color: stage.color,
    position: stage.position,
    plannedDurationDays: stage.plannedDurationDays,
    responsibleRoleIds: stage.responsibleRoleIds,
    alertOffsetsDays: stage.alertOffsetsDays,
    completionGate: stage.completionGate,
    completionPermitted: stage.completionPermitted,
    deadlineOn: stage.deadlineOn ?? null,
    deadlineManual: stage.deadlineManual,
  };
}

/**
 * The audit snapshot of a Stage's task definition: by position — a set
 * replaces the definitions whole, so their ids do not outlive it. The title is
 * a value (O-1) and the description travels as its length.
 */
export function taskDefinitionSnapshot(task: ProjectStageTask): Record<string, unknown> {
  return {
    descriptionLength: task.description.length,
    responsibleRoleId: task.responsibleRoleId ?? null,
    dueOffsetDays: task.dueOffsetDays,
    position: task.position,
  };
}

/** The values of a Stage, a task-definition set or an attachment that the audit log may not hold. */
export type ChildValueState = Pick<ProjectValueState, 'name' | 'taskTitles' | 'fileName'>;

/**
 * Record what a write changed among the values of a Project's child — a
 * Stage's `name`, a Stage's `taskTitles` (by position), an attachment's
 * `fileName` — as a {@link ProjectValueChange} row in the Command's
 * transaction, and answer the keys its audit entry carries instead:
 * `changedFields` (sorted) and `valueChangeId`.
 *
 * `before: null` is something that only arrived and stores no side before;
 * `after: null` is something that went and stores an empty side after (the
 * column is not null). Each stored side holds only what changed; nothing
 * changed writes no row and answers `{}`.
 *
 * **Call it inside a `projects.project.*` Command, with that Command's
 * EntityManager, for a Project loaded through `ProjectAccess`** — the row
 * carries no tenant column of its own.
 */
export function recordChildValueChange(
  em: EntityManager,
  projectId: string,
  change: { before: ChildValueState | null; after: ChildValueState | null },
): { changedFields?: string[]; valueChangeId?: string } {
  const before = (change.before ?? {}) as Record<string, unknown>;
  const after = (change.after ?? {}) as Record<string, unknown>;
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !isDeepStrictEqual(before[field] ?? null, after[field] ?? null))
    .sort();
  if (changedFields.length === 0) return {};
  const side = (values: Record<string, unknown>): ProjectValueState =>
    Object.fromEntries(changedFields.filter((field) => field in values).map((field) => [field, values[field]]));
  // command-coverage-ignore: runs only inside a `projects.project.*` Command's `run`, on the
  // `em` the bus handed it — the row commits with that Command's one audit entry.
  const row = em.create(ProjectValueChange, {
    projectId,
    before: change.before === null ? null : side(before),
    after: change.after === null ? {} : side(after),
  });
  return { changedFields, valueChangeId: row.id };
}
