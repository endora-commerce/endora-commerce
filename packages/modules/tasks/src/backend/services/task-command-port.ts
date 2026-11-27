import {
  CreateTaskBodySchema,
  CreateTaskCommentBodySchema,
  CreateTaskReminderBodySchema,
  ERROR_CODES,
  TaskLinkTargetSchema,
  UpdateTaskBodySchema,
  type AggregateCommandOptions,
  type CreateTaskBody,
  type CreateTaskCommentBody,
  type CreateTaskReminderBody,
  type CustomFieldMerge,
  type NewContextTask,
  type TaskAssigneesChange,
  type TaskCommandPort,
  type TaskContext,
  type TaskLinkTarget,
  type TaskRecord,
  type TaskStatusMove,
  type TaskUpdatePatch,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertCallerSource, type CallerOptions } from '../commands/caller-options.js';
import type { TaskCommentService } from './comment-service.js';
import type { TaskRecordLinkService } from './record-link-service.js';
import type { TaskRelationService } from './relation-service.js';
import type { TaskReminderService } from './reminder-service.js';
import type { TaskAccess, TaskRow } from './task-access.js';
import type { TaskService } from './task-service.js';
import type { TaskTransitionService } from './task-transition-service.js';
import type { TaskWritePortService } from './task-write-port.js';

/**
 * `taskCommandPort` (`specs/186-aggregate-ports/` US10, issue #1829) — the
 * Task aggregate's write port. The contract, the refusals and the options are
 * `TaskCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922), parses its input with the
 * admin route's schema (a refusal is `422 VALIDATION_FAILED`), and runs the
 * service method the route runs — the one that makes the route's checks
 * before its Commands and tells the people the route tells after them — so
 * both paths reach the same effects (research R-22.1, R-23.1). The caller's
 * `source` and `extensions` are added to those Commands by `withCallerOptions`,
 * inside the services, never by a second Command. `createMany` and
 * `deleteInContext` are the context owner's writes the deprecated
 * `taskWritePort` delegates to (R-23.7).
 *
 * The answer is the published record, read after the write by its id
 * (`TaskAccess.rowAfterWrite`), so a write that took the Task out of the
 * caller's own sight still answers it (R-23.5).
 */
export interface TaskCommandServiceDeps {
  readonly tasks: Pick<
    TaskService,
    | 'createTask'
    | 'updateFields'
    | 'setParentOf'
    | 'setPriorityOf'
    | 'setTagsOf'
    | 'setAssigneesOf'
    | 'setPrivacyOf'
    | 'setCustomFieldValues'
    | 'publishTask'
    | 'delete'
    | 'records'
  >;
  readonly transitions: Pick<TaskTransitionService, 'apply'>;
  readonly relations: Pick<TaskRelationService, 'relate' | 'unrelate'>;
  readonly links: Pick<TaskRecordLinkService, 'linkRecord' | 'unlink'>;
  readonly reminders: Pick<TaskReminderService, 'add'>;
  readonly comments: Pick<TaskCommentService, 'add'>;
  readonly contextTasks: Pick<TaskWritePortService, 'createMany' | 'deleteInContext'>;
  readonly access: Pick<TaskAccess, 'rowAfterWrite'>;
}

/**
 * The language a refusal naming statuses is worded in: a port has no reader
 * (`TASK_TRANSITION_FORBIDDEN`'s `allowed`, R-23.4). The codes in
 * `allowedTargets` are what a caller acts on.
 */
const REFUSAL_LANGUAGE = 'en';

/** What `parseOrRefuse` needs of a schema of `@endora-commerce/contracts` — its `safeParse`. */
interface RouteSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } };
}

/**
 * Parses a port input with the admin route's schema; a refusal is the
 * platform's `422 VALIDATION_FAILED` with a field error per issue.
 */
function parseOrRefuse<T>(schema: RouteSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw invalid(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), issue: issue.message })));
}

function invalid(details: Array<{ path: string; issue: string }>): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The Task write is invalid.', details);
}

/** The keys `update` takes — the fields `tasks.task.update` writes (R-23.1). */
const UPDATE_KEYS: readonly (keyof UpdateTaskBody)[] = ['title', 'description', 'dueOn', 'dueAt', 'startOn', 'context'];

/**
 * A port input as the admin `PATCH` body it is a part of: only `keys` may be
 * named, and the values are parsed with the route's own schema, so every limit
 * and refusal is the route's (`422 VALIDATION_FAILED`).
 */
function patchOf(input: unknown, keys: readonly (keyof UpdateTaskBody)[]): UpdateTaskBody {
  if (!input || typeof input !== 'object') throw invalid([{ path: '', issue: 'Expected an object.' }]);
  const extra = Object.keys(input).filter((key) => !keys.includes(key as keyof UpdateTaskBody));
  if (extra.length > 0) {
    throw invalid(extra.map((key) => ({ path: key, issue: 'Not changed by this method.' })));
  }
  return parseOrRefuse(UpdateTaskBodySchema, input);
}

/**
 * A setter's input: an object naming exactly `keys`, each with a value —
 * `null` included, the explicit clear — or `422 VALIDATION_FAILED` before
 * anything is read. The route's schema is `.partial()`, so an absent or
 * `undefined` key would otherwise parse as "change it to nothing" and write a
 * clear: a private Task made public, every tag or assignee removed.
 */
function requiredInput(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid(keys.map((key) => ({ path: key, issue: 'Required' })));
  }
  const record = input as Record<string, unknown>;
  const missing = keys.filter((key) => record[key] === undefined);
  if (missing.length > 0) throw invalid(missing.map((key) => ({ path: key, issue: 'Required' })));
  const extra = Object.keys(record).filter((key) => !keys.includes(key));
  if (extra.length > 0) throw invalid(extra.map((key) => ({ path: key, issue: 'Not changed by this method.' })));
  return record;
}

/** A status code as the move takes it — any string, never checked for its form here (R-23.4). */
function code(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

export class TaskCommandService implements TaskCommandPort {
  constructor(private readonly deps: TaskCommandServiceDeps) {}

  async create(input: CreateTaskBody, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateTaskBodySchema, input);
    return this.#record(await this.deps.tasks.createTask(body, caller));
  }

  async createMany(
    input: { context: TaskContext; tasks: NewContextTask[] },
    options: AggregateCommandOptions = {},
  ): Promise<{ ids: string[] }> {
    return this.deps.contextTasks.createMany(input, callerOf(options));
  }

  async update(id: string, patch: TaskUpdatePatch, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    const body = patchOf(patch, UPDATE_KEYS);
    return this.#record(await this.deps.tasks.updateFields(id, body, caller));
  }

  async setParent(
    id: string,
    input: { readonly parentTaskId: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<TaskRecord> {
    const caller = callerOf(options);
    const { parentTaskId } = requiredInput(input, ['parentTaskId']);
    const body = patchOf({ parentTaskId }, ['parentTaskId']);
    return this.#record(await this.deps.tasks.setParentOf(id, body.parentTaskId as string | null, caller));
  }

  async setPriority(
    id: string,
    input: { readonly priorityCode: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<TaskRecord> {
    const caller = callerOf(options);
    const { priorityCode } = requiredInput(input, ['priorityCode']);
    const body = patchOf({ priorityCode }, ['priorityCode']);
    return this.#record(await this.deps.tasks.setPriorityOf(id, body.priorityCode as string | null, caller));
  }

  async setTags(
    id: string,
    input: { readonly tagIds: readonly string[] },
    options: AggregateCommandOptions = {},
  ): Promise<TaskRecord> {
    const caller = callerOf(options);
    const { tagIds } = requiredInput(input, ['tagIds']);
    const body = patchOf({ tagIds }, ['tagIds']);
    return this.#record(await this.deps.tasks.setTagsOf(id, body.tagIds as string[], caller));
  }

  async setAssignees(id: string, change: TaskAssigneesChange, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    if (change !== null && typeof change === 'object' && 'set' in change) {
      // `{ set }` alone: an `add` or `remove` beside it is an extra key, refused.
      const { set } = requiredInput(change, ['set']);
      const body = patchOf({ assigneeIds: set }, ['assigneeIds']);
      return this.#record(await this.deps.tasks.setAssigneesOf(id, { set: body.assigneeIds as string[] }, caller));
    }
    const { add, remove } = requiredInput(change, ['add', 'remove']);
    const body = patchOf({ addAssigneeIds: add, removeAssigneeIds: remove }, ['addAssigneeIds', 'removeAssigneeIds']);
    return this.#record(
      await this.deps.tasks.setAssigneesOf(
        id,
        { add: body.addAssigneeIds as string[], remove: body.removeAssigneeIds as string[] },
        caller,
      ),
    );
  }

  async setPrivate(id: string, input: { readonly private: boolean }, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    const { private: isPrivate } = requiredInput(input, ['private']);
    // Never coerced: anything but `true` or `false` would otherwise make a private Task public.
    if (typeof isPrivate !== 'boolean') throw invalid([{ path: 'private', issue: 'Expected a boolean.' }]);
    return this.#record(await this.deps.tasks.setPrivacyOf(id, isPrivate, caller));
  }

  async setStatus(id: string, move: TaskStatusMove, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    if (!move || typeof move !== 'object') throw invalid([{ path: 'to', issue: 'Required' }]);
    const { taskId } = await this.deps.transitions.apply(
      id,
      { to: code(move.to), ...(move.from !== undefined ? { from: code(move.from) } : {}) },
      REFUSAL_LANGUAGE,
      caller,
    );
    return this.#record(await this.deps.access.rowAfterWrite(taskId));
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<TaskRecord> {
    const caller = callerOf(options);
    if (typeof merge !== 'function') throw invalid([{ path: 'merge', issue: 'Expected a function.' }]);
    return this.#record(await this.deps.tasks.setCustomFieldValues(id, merge, caller));
  }

  async publish(id: string, options: AggregateCommandOptions = {}): Promise<TaskRecord> {
    const caller = callerOf(options);
    return this.#record(await this.deps.tasks.publishTask(id, caller));
  }

  async relate(id: string, otherId: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.relations.relate(id, code(otherId), caller);
  }

  async unrelate(id: string, otherId: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.relations.unrelate(id, code(otherId), caller);
  }

  async link(id: string, target: TaskLinkTarget, options: AggregateCommandOptions = {}): Promise<{ linkId: string }> {
    const caller = callerOf(options);
    const parsed = parseOrRefuse(TaskLinkTargetSchema, target);
    const { linkId } = await this.deps.links.linkRecord(id, parsed, caller);
    return { linkId };
  }

  async unlink(id: string, linkId: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.links.unlink(id, code(linkId), caller);
  }

  async addReminder(
    id: string,
    input: CreateTaskReminderBody,
    options: AggregateCommandOptions = {},
  ): Promise<{ reminderId: string }> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateTaskReminderBodySchema, input);
    const reminder = await this.deps.reminders.add(id, body, caller);
    return { reminderId: reminder.id };
  }

  async addComment(
    id: string,
    input: CreateTaskCommentBody,
    options: AggregateCommandOptions = {},
  ): Promise<{ commentId: string }> {
    const caller = callerOf(options);
    const { body } = parseOrRefuse(CreateTaskCommentBodySchema, input);
    const comment = await this.deps.comments.add(id, body, caller);
    return { commentId: comment.id };
  }

  async delete(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.tasks.delete(id, caller);
  }

  async deleteInContext(
    q: { contextType: string; contextId: string },
    options: AggregateCommandOptions = {},
  ): Promise<{ deleted: number }> {
    return this.deps.contextTasks.deleteInContext(q, callerOf(options));
  }

  async #record(row: TaskRow): Promise<TaskRecord> {
    const [record] = await this.deps.tasks.records([row]);
    return record!;
  }
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 * `expectedVersion` is ignored: a Task has no `version` column (R-23.4).
 */
function callerOf(options: AggregateCommandOptions | undefined): CallerOptions {
  assertCallerSource(options ?? {});
  return { source: options?.source, extensions: options?.extensions };
}
