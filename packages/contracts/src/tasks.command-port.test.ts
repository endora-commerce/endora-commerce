import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CreateTaskBody,
  CreateTaskCommentBody,
  CreateTaskReminderBody,
  NewContextTask,
  TaskCommandPort,
  TaskContext,
  TaskLinkTarget,
  TaskRecord,
  TaskStatusMove,
  TaskUpdatePatch,
  TaskWritePort,
  UpdateTaskBody,
} from './tasks.js';

/**
 * `specs/186-aggregate-ports/` T092 (issue #1829) — the Task aggregate port's
 * published shape: one method per operation of `contracts/task-command-port.md`,
 * each taking the admin body and ending in the aggregate ports' options; the
 * record carrying the custom-field values (FR-015); and the deprecated write
 * port's methods matching the ones that replace them.
 */
describe('TaskCommandPort (186 US10)', () => {
  it('declares the operations of the Task aggregate', () => {
    expectTypeOf<keyof TaskCommandPort>().toEqualTypeOf<
      | 'create'
      | 'createMany'
      | 'update'
      | 'setStatus'
      | 'setCustomFieldValues'
      | 'publish'
      | 'relate'
      | 'unrelate'
      | 'link'
      | 'unlink'
      | 'addReminder'
      | 'addComment'
      | 'delete'
      | 'deleteInContext'
    >();
  });

  it('takes the admin bodies and ends every method in the aggregate ports’ options', () => {
    expectTypeOf<TaskCommandPort['create']>().toEqualTypeOf<
      (input: CreateTaskBody, options?: AggregateCommandOptions) => Promise<TaskRecord>
    >();
    expectTypeOf<TaskCommandPort['update']>().toEqualTypeOf<
      (id: string, patch: TaskUpdatePatch, options?: AggregateCommandOptions) => Promise<TaskRecord>
    >();
    expectTypeOf<TaskCommandPort['setStatus']>().toEqualTypeOf<
      (id: string, move: TaskStatusMove, options?: AggregateCommandOptions) => Promise<TaskRecord>
    >();
    expectTypeOf<TaskCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<TaskRecord>
    >();
    expectTypeOf<TaskCommandPort['relate']>().toEqualTypeOf<
      (id: string, otherId: string, options?: AggregateCommandOptions) => Promise<void>
    >();
    expectTypeOf<TaskCommandPort['link']>().toEqualTypeOf<
      (id: string, target: TaskLinkTarget, options?: AggregateCommandOptions) => Promise<{ linkId: string }>
    >();
    expectTypeOf<TaskCommandPort['addReminder']>().toEqualTypeOf<
      (id: string, input: CreateTaskReminderBody, options?: AggregateCommandOptions) => Promise<{ reminderId: string }>
    >();
    expectTypeOf<TaskCommandPort['addComment']>().toEqualTypeOf<
      (id: string, input: CreateTaskCommentBody, options?: AggregateCommandOptions) => Promise<{ commentId: string }>
    >();
  });

  it('updates what the PATCH changes, never the custom fields', () => {
    expectTypeOf<keyof TaskUpdatePatch>().toEqualTypeOf<Exclude<keyof UpdateTaskBody, 'customFieldValues'>>();
    expectTypeOf<TaskUpdatePatch['assigneeIds']>().toEqualTypeOf<UpdateTaskBody['assigneeIds']>();
  });

  it('takes the target status and, optionally, the one the caller read', () => {
    expectTypeOf<TaskStatusMove>().toEqualTypeOf<{ readonly to: string; readonly from?: string }>();
  });

  it('keeps the deprecated write port’s two methods on the aggregate port', () => {
    expectTypeOf<Parameters<TaskCommandPort['createMany']>[0]>().toEqualTypeOf<{
      context: TaskContext;
      tasks: NewContextTask[];
    }>();
    expectTypeOf<Parameters<TaskWritePort['createMany']>[0]>().toEqualTypeOf<
      Parameters<TaskCommandPort['createMany']>[0]
    >();
    expectTypeOf<ReturnType<TaskWritePort['deleteInContext']>>().toEqualTypeOf<
      ReturnType<TaskCommandPort['deleteInContext']>
    >();
  });

  it('carries the custom-field values on the record', () => {
    expectTypeOf<TaskRecord['customFieldValues']>().toEqualTypeOf<Record<string, unknown>>();
  });
});
