import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { isDeepStrictEqual } from 'node:util';
import {
  TASK_ASSIGNEES_MAX,
  TASKS_EVENTS,
  type TaskAssigneesChangedEvent,
  type TaskContext,
  type TaskCreatedEvent,
  type TaskDeletedEvent,
  type TaskLinkTarget,
} from '@endora-commerce/contracts';
import { recordAuditFromContext, type Command } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { Task } from '../entities/task.entity.js';
import { TaskAssignee } from '../entities/task-assignee.entity.js';
import { TaskPriority } from '../entities/task-priority.entity.js';
import { TaskRecordLink } from '../entities/task-record-link.entity.js';
import { TaskReference } from '../entities/task-reference.entity.js';
import { TaskTagAssignment } from '../entities/task-tag-assignment.entity.js';
import { assertParentFits, lockHierarchy } from './hierarchy-service.js';
import { newlyMentioned } from './mention-service.js';
import { priorityUnknown } from './priority-service.js';
import { dueMomentOf, followDueMoment } from './reminder-schedule.js';
import { referenceRowsFor } from './reference-service.js';
import { taskAlreadyPublished, taskAssigneeInvalid, taskNotFound } from './task-errors.js';
import { nextTaskNumber } from './task-number.js';
import { recordTaskValueChange } from './task-audit-state.js';

/**
 * The Commands every write of a Task runs (`specs/165-task-management/`
 * data-model §7, Constitution XIII) — one action per kind of change, each with
 * its own audit row and, where the contract names one, its own event on commit:
 *
 * | Action | Event |
 * | --- | --- |
 * | `tasks.task.create` | `tasks.task.created.v1` |
 * | `tasks.task.update` (title, description, due date and time, start date, context) | — |
 * | `tasks.task.priority_change` | — |
 * | `tasks.task.tags_change` | — |
 * | `tasks.task.custom_fields_change` | — |
 * | `tasks.task.assignees_change` | `tasks.task.assignees_changed.v1` |
 * | `tasks.task.status_change` (`task-transition-service.ts`) | `tasks.task.status_changed.v1` |
 * | `tasks.task.parent_change` (`hierarchy-service.ts`) | — |
 * | `tasks.task.relate` / `.unrelate` (`relation-service.ts`) | — |
 * | `tasks.task.link` / `.unlink` (`record-link-service.ts`) | — |
 * | `tasks.task.publish` | `tasks.task.created.v1` |
 * | `tasks.task.privacy_change` | — |
 * | `tasks.task.delete` | `tasks.task.deleted.v1` |
 *
 * **A draft emits nothing** (research R-3): for every other module it does
 * not exist until it is published, so its creation, assignee changes, status
 * moves and deletion are audited but published as no event; publishing it
 * emits `tasks.task.created.v1`, with the assignees it has then.
 *
 * Shared by the HTTP service and the write port, so a Task created by another
 * module is the same Command as one created on the Tasks screen. Every
 * validation a Command depends on — the context's owner, the assignees, the
 * workflow move — is the caller's to make **before** it runs the first
 * Command; a Command re-reads under its lock only what can move meanwhile.
 *
 * Audit states carry no description text: the audit trail is not tenant-scoped
 * and a description may hold whatever its writer typed — its length is enough
 * to show that it changed (the CRM rule).
 *
 * The Command that saves a description also rewrites its `task_references`
 * rows (research R-5) — an index of the tokens, never part of the audited
 * state — and answers who the text newly mentions, for the caller to tell
 * after the commit.
 */

/** A Task's fields as the create Command writes them. */
export interface NewTaskFields {
  title: string;
  description: string;
  assigneeIds: readonly string[];
  dueOn: string | null;
  /** A due moment; the caller derives `dueOn` from it in `tasks.time_zone`. */
  dueAt?: Date | null;
  startOn?: string | null;
  /** Checked against the priority list by the caller. */
  priorityCode?: string | null;
  /** Checked to exist by the caller. */
  tagIds?: readonly string[];
  /** Validated and merged by `custom_fields` before the Command runs (R-8). */
  customFieldValues?: Record<string, unknown>;
  /**
   * A parent the caller may see and change (`TaskHierarchyService.assertMayAdopt`);
   * its depth is checked by the Command, under the hierarchy lock (R-15).
   */
  parentTaskId?: string | null;
  /** Records validated by the caller (`TaskRecordLinkService.assertLinkable`), distinct (R-16). */
  links?: readonly TaskLinkTarget[];
  contextNote: string | null;
  /** The workflow's initial status at the moment of the call (data-model §5). */
  status: string;
  /** Visible to its Creator only until published (FR-037); never set by the write port. */
  draft?: boolean;
  /** Visible to its Creator and `tasks:see_private` holders (FR-038); the caller checked it has no context. */
  private?: boolean;
  /**
   * The context owner's own key for the Task (R-19), unique per context: a
   * second Task with it fails the Command on the unique index, which the write
   * port reads as "already created". Only the write port sets it.
   */
  sourceKey?: string | null;
}

/** The editable fields a `tasks.task.update` changes; `undefined` leaves one as it is. */
export interface TaskFieldChanges {
  title?: string;
  description?: string;
  dueOn?: string | null;
  dueAt?: Date | null;
  startOn?: string | null;
  context?: TaskContext | null;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/**
 * The audit snapshot of a Task: names and structure only (#470,
 * `TASKS_AUDIT_KEYS`). The title and the context note are values — they go to
 * the Task's value store ({@link taskValues}).
 */
export function auditSnapshot(task: Task): Record<string, unknown> {
  return {
    number: task.number,
    descriptionLength: task.description.length,
    status: task.status,
    dueOn: task.dueOn ?? null,
    dueAt: isoOrNull(task.dueAt),
    startOn: task.startOn ?? null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    contextType: task.contextType ?? null,
    contextId: task.contextId ?? null,
    contextGroupId: task.contextGroupId ?? null,
  };
}

/** The values of a Task its history shows and the audit log may not hold (#470). */
export function taskValues(task: Task): Record<string, unknown> {
  return { title: task.title, contextNote: task.contextNote ?? null };
}

/** An event's `eventId` / `occurredAt` envelope. */
export function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

/** One Task, locked for the Command's transaction — by an id `TaskAccess` handed out. */
export async function lockedTask(em: EntityManager, id: string): Promise<Task> {
  const task = await em.findOne(Task, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!task) throw taskNotFound();
  return task;
}

/** The assignees of one Task, in the order they were given it. */
async function assigneesOf(em: EntityManager, taskId: string): Promise<string[]> {
  const rows = await em.find(TaskAssignee, { taskId }, { orderBy: { assignedAt: 'asc', adminUserId: 'asc' } });
  return rows.map((row) => row.adminUserId);
}

/**
 * Hold the priority a Task is being given **shared** until the Command commits
 * (issue #507), as `task-transition-service.ts` holds a target status: a
 * removal of it, which locks the row for update, waits for this Task's write
 * and then moves it with the others; or it committed first and this answers 422
 * `TASK_PRIORITY_UNKNOWN`. The caller's check before the Command only spares a
 * transaction — this is the one that holds. `null` (no priority) needs none.
 */
async function holdPriority(em: EntityManager, code: string | null): Promise<void> {
  if (code === null) return;
  const priority = await em.findOne(TaskPriority, { code }, { lockMode: LockMode.PESSIMISTIC_READ });
  if (!priority) throw priorityUnknown(code);
}

/** Replace the description's `task_references` rows with what `description` holds now. */
async function rewriteDescriptionReferences(em: EntityManager, taskId: string, description: string): Promise<void> {
  await em.nativeDelete(TaskReference, { taskId, sourceKind: 'description' });
  for (const row of referenceRowsFor({ taskId, kind: 'description', sourceId: null }, description)) {
    em.create(TaskReference, row);
  }
}

/** `tasks.task.create` — the result is the new Task's id. Published at once unless it is a draft (R-3). */
export function createTaskCommand(context: TaskContext | null, input: NewTaskFields): Command<string> {
  const id = randomUUID();
  let created: Task | null = null;
  return {
    action: 'tasks.task.create',
    objectType: 'task',
    objectId: id,
    run: async ({ em, actor }) => {
      if (actor.actorAdminUserId === null) {
        // `created_by_admin_user_id` is not null: a Task is created on behalf
        // of somebody, and the caller acts for them.
        throw new Error('tasks: a Task is created by an administrator; the ambient actor is none.');
      }
      const scoped = em as EntityManager;
      const now = new Date();
      await holdPriority(scoped, input.priorityCode ?? null);
      const tagIds = [...new Set(input.tagIds ?? [])];
      const parentTaskId = input.parentTaskId ?? null;
      if (parentTaskId !== null) {
        await lockHierarchy(scoped);
        await assertParentFits(scoped, null, parentTaskId);
      }
      const task = scoped.create(Task, {
        id,
        number: await nextTaskNumber(scoped),
        title: input.title,
        description: input.description,
        status: input.status,
        dueOn: input.dueOn,
        dueAt: input.dueAt ?? null,
        startOn: input.startOn ?? null,
        priorityCode: input.priorityCode ?? null,
        customFieldValues: input.customFieldValues ?? {},
        parentTaskId,
        sourceKey: input.sourceKey ?? null,
        createdByAdminUserId: actor.actorAdminUserId,
        contextType: context?.contextType ?? null,
        contextId: context?.contextId ?? null,
        contextGroupId: context?.contextGroupId ?? null,
        contextNote: input.contextNote,
        isDraft: input.draft ?? false,
        isPrivate: input.private ?? false,
        publishedAt: input.draft ? null : now,
      });
      const references = referenceRowsFor({ taskId: id, kind: 'description', sourceId: null }, input.description);
      const links = input.links ?? [];
      if (input.assigneeIds.length > 0 || tagIds.length > 0 || references.length > 0 || links.length > 0) {
        // The child rows name the Task by value (no ORM relation), so the unit
        // of work cannot order them after it: the Task is written first.
        await scoped.flush();
        // One millisecond apart, so the order they were given in is the order they are read in.
        input.assigneeIds.forEach((adminUserId, index) => {
          scoped.create(TaskAssignee, {
            taskId: id,
            adminUserId,
            assignedAt: new Date(now.getTime() + index),
            assignedByAdminUserId: actor.actorAdminUserId,
          });
        });
        for (const tagId of tagIds) scoped.create(TaskTagAssignment, { taskId: id, tagId });
        for (const row of references) scoped.create(TaskReference, row);
        for (const link of links) {
          scoped.create(TaskRecordLink, {
            taskId: id,
            recordKind: link.kind,
            recordId: link.id,
            linkedByAdminUserId: actor.actorAdminUserId,
          });
        }
      }
      created = task;
      // The values go to the Task's own store; the entry names them (#470).
      // The row names the Task by value, so the Task is written first, as
      // for the other child rows above.
      await scoped.flush();
      const values = recordTaskValueChange(scoped, id, {
        before: null,
        after: { ...taskValues(task), customFieldValues: { ...task.customFieldValues } },
      });
      return {
        result: id,
        before: null,
        after: {
          ...auditSnapshot(task),
          ...(task.isDraft ? { draft: true } : {}),
          ...(task.isPrivate ? { private: true } : {}),
          priorityCode: task.priorityCode ?? null,
          assigneeIds: [...input.assigneeIds],
          tagIds,
          ...(parentTaskId !== null ? { parentTaskId } : {}),
          ...(links.length > 0 ? { links: links.map((link) => ({ kind: link.kind, recordId: link.id })) } : {}),
          ...values,
        },
      };
    },
    event: () => {
      const task = created!;
      // A draft does not exist for other modules yet: `tasks.task.publish` announces it.
      if (task.isDraft) return undefined;
      return { eventName: TASKS_EVENTS.CREATED, payload: createdEvent(task, input.assigneeIds) };
    },
  };
}

function createdEvent(task: Task, assigneeIds: readonly string[]): TaskCreatedEvent {
  return {
    ...envelope(),
    taskId: task.id,
    contextType: task.contextType ?? null,
    contextId: task.contextId ?? null,
    contextGroupId: task.contextGroupId ?? null,
    assigneeIds: [...assigneeIds],
  };
}

/**
 * `tasks.task.publish` — a draft becomes a normal Task (FR-037), one-way.
 * Re-checked under the lock, so two publishes of one draft publish it once:
 * the second is 409 `TASK_ALREADY_PUBLISHED`. Emits `tasks.task.created.v1`
 * with the assignees it has now; telling them is the caller's, after commit.
 * Whether the caller is its Creator is the caller's to have asked.
 */
export function publishTaskCommand(id: string): Command<{ assigneeIds: string[] }> {
  let published: Task | null = null;
  return {
    action: 'tasks.task.publish',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const scoped = em as EntityManager;
      const task = await lockedTask(scoped, id);
      if (!task.isDraft) throw taskAlreadyPublished();
      task.isDraft = false;
      task.publishedAt = new Date();
      published = task;
      return {
        result: { assigneeIds: await assigneesOf(scoped, id) },
        before: { draft: true, publishedAt: null },
        after: { draft: false, publishedAt: task.publishedAt.toISOString() },
      };
    },
    event: (result) => ({ eventName: TASKS_EVENTS.CREATED, payload: createdEvent(published!, result.assigneeIds) }),
  };
}

/**
 * `tasks.task.privacy_change` — the Task made private or public again by its
 * Creator (FR-038). `false` when it already was (nothing written, nothing
 * audited). Its having no context and no assignee but the Creator is the
 * caller's to have checked; the database's check holds the first.
 */
export function changeTaskPrivacyCommand(id: string, isPrivate: boolean): Command<boolean> {
  return {
    action: 'tasks.task.privacy_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await lockedTask(em as EntityManager, id);
      if (task.isPrivate === isPrivate) return { result: false, skipAudit: true };
      task.isPrivate = isPrivate;
      return { result: true, before: { private: !isPrivate }, after: { private: isPrivate } };
    },
  };
}

/**
 * `tasks.task.update` — the fields that are not an assignment, a status, a
 * priority, tags or custom fields. No event. The result is who a changed
 * description newly mentions (none when the description did not change).
 */
export function updateTaskCommand(
  id: string,
  changes: TaskFieldChanges,
  reminders: { timeZone: string; auditLog: AuditPort },
): Command<{ mentioned: string[] }> {
  return {
    action: 'tasks.task.update',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const scoped = em as EntityManager;
      const task = await lockedTask(scoped, id);
      const before = auditSnapshot(task);
      const valuesBefore = taskValues(task);
      let mentioned: string[] = [];
      if (changes.title !== undefined) task.title = changes.title;
      if (changes.description !== undefined && changes.description !== task.description) {
        mentioned = newlyMentioned(task.description, changes.description);
        task.description = changes.description;
        await rewriteDescriptionReferences(scoped, task.id, task.description);
      }
      if (changes.dueOn !== undefined) task.dueOn = changes.dueOn;
      if (changes.dueAt !== undefined) task.dueAt = changes.dueAt;
      if (changes.dueOn !== undefined || changes.dueAt !== undefined) {
        // Relative reminders follow the due moment in this same Command (R-17).
        const moment = dueMomentOf({ dueOn: task.dueOn ?? null, dueAt: task.dueAt ?? null }, reminders.timeZone);
        await followDueMoment(scoped, reminders.auditLog, task.id, moment);
      }
      if (changes.startOn !== undefined) task.startOn = changes.startOn;
      if (changes.context !== undefined) {
        task.contextType = changes.context?.contextType ?? null;
        task.contextId = changes.context?.contextId ?? null;
        task.contextGroupId = changes.context?.contextGroupId ?? null;
      }
      const values = recordTaskValueChange(scoped, task.id, { before: valuesBefore, after: taskValues(task) });
      return { result: { mentioned }, before, after: { ...auditSnapshot(task), ...values } };
    },
  };
}

/**
 * `tasks.task.priority_change` — `false` when the Task already has it (nothing
 * written, nothing audited). The priority is held before the Task is locked —
 * the order a removal takes them in (the priority, then its Tasks) — so a
 * removal naming this priority as the replacement cannot deadlock with it.
 */
export function changeTaskPriorityCommand(id: string, priorityCode: string | null): Command<boolean> {
  return {
    action: 'tasks.task.priority_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      await holdPriority(em as EntityManager, priorityCode);
      const task = await lockedTask(em as EntityManager, id);
      const current = task.priorityCode ?? null;
      if (current === priorityCode) return { result: false, skipAudit: true };
      task.priorityCode = priorityCode;
      return { result: true, before: { priorityCode: current }, after: { priorityCode } };
    },
  };
}

/**
 * `tasks.task.update` with `reason: 'context_group_gone'` — the maintenance
 * pass taking a group its context's owner no longer has off a Task (R-19): a
 * Project's Stage deleted while Tasks was off. Re-read under the lock: a Task
 * that left the group or the context meanwhile is left as it is (`false`, not
 * audited). No event, as for any `tasks.task.update`.
 */
export function ungroupTaskCommand(
  id: string,
  from: { contextType: string; contextId: string; contextGroupId: string },
): Command<boolean> {
  return {
    action: 'tasks.task.update',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await (em as EntityManager).findOne(Task, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (
        !task ||
        task.contextType !== from.contextType ||
        task.contextId !== from.contextId ||
        task.contextGroupId !== from.contextGroupId
      ) {
        return { result: false, skipAudit: true };
      }
      task.contextGroupId = null;
      return {
        result: true,
        before: { contextGroupId: from.contextGroupId },
        after: { contextGroupId: null, reason: 'context_group_gone' },
      };
    },
  };
}

/** `tasks.task.tags_change` — the whole set replaced; `false` when it did not change. */
export function changeTaskTagsCommand(id: string, tagIds: readonly string[]): Command<boolean> {
  return {
    action: 'tasks.task.tags_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const scoped = em as EntityManager;
      await lockedTask(scoped, id);
      const current = (await scoped.find(TaskTagAssignment, { taskId: id })).map((row) => row.tagId).sort();
      const next = [...new Set(tagIds)].sort();
      const added = next.filter((tagId) => !current.includes(tagId));
      const removed = current.filter((tagId) => !next.includes(tagId));
      if (added.length === 0 && removed.length === 0) return { result: false, skipAudit: true };
      if (removed.length > 0) await scoped.nativeDelete(TaskTagAssignment, { taskId: id, tagId: { $in: removed } });
      for (const tagId of added) scoped.create(TaskTagAssignment, { taskId: id, tagId });
      return { result: true, before: { tagIds: current }, after: { tagIds: next } };
    },
  };
}

/**
 * `tasks.task.custom_fields_change` — the bag `custom_fields` validated and
 * merged; the audit row names the keys that changed, and the Task's value
 * store holds them before and after (#470).
 * `false` when nothing changed.
 */
export function changeTaskCustomFieldsCommand(id: string, merged: Record<string, unknown>): Command<boolean> {
  return {
    action: 'tasks.task.custom_fields_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await lockedTask(em as EntityManager, id);
      const current = task.customFieldValues ?? {};
      const keys = [...new Set([...Object.keys(current), ...Object.keys(merged)])].filter(
        (key) => !isDeepStrictEqual(current[key], merged[key]),
      );
      if (keys.length === 0) return { result: false, skipAudit: true };
      task.customFieldValues = merged;
      // The values go to the Task's own store; the entry names the keys (#470).
      const values = recordTaskValueChange(em as EntityManager, task.id, {
        before: { customFieldValues: { ...current } },
        after: { customFieldValues: { ...merged } },
      });
      return { result: true, before: null, after: { ...values } };
    },
  };
}

/** How a `PATCH` changes the assignee set: replace it, or add and remove. */
export type AssigneeChange =
  | { readonly set: readonly string[] }
  | { readonly add: readonly string[]; readonly remove: readonly string[] };

/**
 * `tasks.task.assignees_change` (research R-2) — the result is who was added
 * and who removed, or `undefined` when the set did not change (nothing
 * written, nothing audited).
 */
export function changeTaskAssigneesCommand(
  id: string,
  change: AssigneeChange,
): Command<{ added: string[]; removed: string[] } | undefined> {
  let draft = false;
  return {
    action: 'tasks.task.assignees_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em, actor }) => {
      const scoped = em as EntityManager;
      draft = (await lockedTask(scoped, id)).isDraft;
      const current = await assigneesOf(scoped, id);
      const next =
        'set' in change
          ? [...new Set(change.set)]
          : [...current.filter((who) => !change.remove.includes(who)), ...change.add.filter((who) => !current.includes(who))];
      const added = next.filter((who) => !current.includes(who));
      const removed = current.filter((who) => !next.includes(who));
      if (added.length === 0 && removed.length === 0) return { result: undefined, skipAudit: true };
      // FR-001: at most this many, counted under the lock, whichever form changed the set.
      if (next.length > TASK_ASSIGNEES_MAX) throw taskAssigneeInvalid();
      if (removed.length > 0) await scoped.nativeDelete(TaskAssignee, { taskId: id, adminUserId: { $in: removed } });
      const now = new Date();
      // One millisecond apart, so the order they were given in is the order they are read in.
      added.forEach((adminUserId, index) => {
        scoped.create(TaskAssignee, {
          taskId: id,
          adminUserId,
          assignedAt: new Date(now.getTime() + index),
          assignedByAdminUserId: actor.actorAdminUserId ?? null,
        });
      });
      return {
        result: { added, removed },
        before: { assigneeIds: current },
        after: { assigneeIds: [...current.filter((who) => !removed.includes(who)), ...added] },
      };
    },
    event: (result) => {
      if (!result || draft) return undefined;
      const payload: TaskAssigneesChangedEvent = { ...envelope(), taskId: id, ...result };
      return { eventName: TASKS_EVENTS.ASSIGNEES_CHANGED, payload };
    },
  };
}

/** What deleting a Task did: whether it was there, and which sub-tasks became top-level. */
export interface TaskDeletion {
  deleted: boolean;
  /** Every former sub-task, whoever may see it — the caller counts those its reader may (FR-028). */
  detachedIds: string[];
}

/**
 * `tasks.task.delete` — `deleted: false` when the Task was already gone
 * (nothing audited). Its sub-tasks become top-level (FR-029): the database's
 * `on delete set null` clears their parent, under the hierarchy lock, and each
 * gets a `tasks.task.parent_change` entry of its own (`reason:
 * 'parent_deleted'`) on this Command's transaction through the kernel's audit
 * port — a former sub-task's history says why it has no parent any more.
 */
export function deleteTaskCommand(
  id: string,
  auditLog: AuditPort,
  options: {
    /**
     * Why the Task went, when nobody asked for it: the maintenance pass's
     * `context_gone` (R-19). Recorded as the audit row's `after`.
     */
    reason?: string;
    /**
     * Delete only while the Task is still in this context — re-read under the
     * lock; a Task moved out meanwhile is left (`deleted: false`, not audited).
     */
    onlyIn?: TaskContext;
  } = {},
): Command<TaskDeletion> {
  let gone: { contextType: string | null; contextId: string | null; draft: boolean } | null = null;
  return {
    action: 'tasks.task.delete',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const scoped = em as EntityManager;
      await lockHierarchy(scoped);
      const task = await scoped.findOne(Task, { id }, options.onlyIn ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {});
      if (!task) return { result: { deleted: false, detachedIds: [] }, skipAudit: true };
      const { onlyIn } = options;
      if (onlyIn && (task.contextType !== onlyIn.contextType || task.contextId !== onlyIn.contextId)) {
        return { result: { deleted: false, detachedIds: [] }, skipAudit: true };
      }
      const before = auditSnapshot(task);
      gone = { contextType: task.contextType ?? null, contextId: task.contextId ?? null, draft: task.isDraft };
      // Keyed by the Task the caller loaded: its sub-tasks, whoever may see them.
      const children = (await scoped.execute(`select "id" from "tasks" where "parent_task_id" = ? order by "id"`, [
        id,
      ])) as Array<{ id: string }>;
      for (const child of children) {
        recordAuditFromContext(auditLog, scoped, {
          action: 'tasks.task.parent_change',
          objectType: 'task',
          objectId: child.id,
          stateBefore: { parentTaskId: id },
          stateAfter: { parentTaskId: null, reason: 'parent_deleted' },
        });
      }
      scoped.remove(task);
      return {
        result: { deleted: true, detachedIds: children.map((child) => child.id) },
        before,
        after: options.reason ? { reason: options.reason } : null,
      };
    },
    event: (result) => {
      if (!result.deleted || !gone || gone.draft) return undefined;
      const payload: TaskDeletedEvent = {
        ...envelope(),
        taskId: id,
        contextType: gone.contextType,
        contextId: gone.contextId,
      };
      return { eventName: TASKS_EVENTS.DELETED, payload };
    },
  };
}
