import { z } from 'zod';
import { calendarDateSchema, isoDateTimeSchema } from './common.js';
import { customFieldFiltersQueryParamSchema, customFieldValuesSchema } from './custom-fields.js';
import { dataEnvelope } from './envelopes.js';
import type { SupportedLanguage } from './platform-language.js';
import { RecordReferenceSchema } from './record-references.js';

/**
 * Tasks — `specs/163-projects-and-tasks/`, grown into a work-management module
 * by `specs/165-task-management/`.
 *
 * Every request, response, port, registry and event shape of the `tasks`
 * module, written before the first route (Constitution II) and for **every**
 * story of feature 165 — later phases add no contract here. The normative prose
 * is `specs/165-task-management/contracts/admin-api.md` §1–§5 and
 * `contracts/ports-and-events.md`; the schema is `data-model.md`.
 *
 * What 165 changed, all of it breaking for a consumer of the published shapes:
 *
 * - **A status is a code** of the operator's workflow, grouped into the three
 *   {@link TASK_STATUS_CATEGORIES}; *closed* means category `done` or
 *   `cancelled` (research R-1, FR-017). The four codes 163 fixed are the seed.
 * - **A Task has a list of assignees**, not one (R-2): `assigneeIds` on every
 *   write and on {@link TaskRecord}, `assignees` on every read.
 * - **`tasks.task.assigned.v1` is gone**, replaced by
 *   `tasks.task.assignees_changed.v1`; `status_changed` carries codes and the
 *   target's category (`data-model.md` §8).
 *
 * A Task may belong to an **opaque context** — `contextType` / `contextId` /
 * `contextGroupId` — through which another module owns it (a Project and one
 * of its Stages, today). `tasks` names no such module: the context's owner
 * registers a {@link TaskContextDescriptor} that answers who may see its
 * contexts and how to label them (163 research R-1, R-9).
 *
 * Base path of the HTTP API: `/api/v1/admin/tasks`. There is no storefront or
 * customer route (FR-044).
 */

// ---------------------------------------------------------------------------
// Vocabulary and limits
// ---------------------------------------------------------------------------

/**
 * A code of the operator's workflow, or of the priority list: snake_case,
 * starting with a letter, at most 64 characters. Held **by value** on a Task,
 * never by foreign key (research R-1, R-9).
 */
const snakeCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'A code is snake_case and starts with a letter');

/** A Task's status — a code of the configured workflow (R-1). */
export const taskStatusCodeSchema = snakeCodeSchema;
export type TaskStatusCode = z.infer<typeof taskStatusCodeSchema>;

/**
 * The four statuses the upgrade seeds, in workflow order (FR-014): every 163
 * Task already holds one of them, so no row changes. Kept for the seed and the
 * tests; the live workflow is the operator's.
 */
export const TASK_DEFAULT_STATUS_CODES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type TaskDefaultStatusCode = (typeof TASK_DEFAULT_STATUS_CODES)[number];

/** What a status means for the Task: still worked, finished, or abandoned. */
export const TASK_STATUS_CATEGORIES = ['open', 'done', 'cancelled'] as const;
export const taskStatusCategorySchema = z.enum(TASK_STATUS_CATEGORIES);
export type TaskStatusCategory = z.infer<typeof taskStatusCategorySchema>;

/**
 * The categories a Task is **closed** in (FR-017) — *My Tasks*, overdue, the
 * digest, sub-task progress and the Projects completion gate all read this.
 */
export const TASK_CLOSED_STATUS_CATEGORIES = ['done', 'cancelled'] as const satisfies readonly TaskStatusCategory[];

export function isClosedTaskStatusCategory(category: TaskStatusCategory): boolean {
  return (TASK_CLOSED_STATUS_CATEGORIES as readonly TaskStatusCategory[]).includes(category);
}

/** A priority — a code of the configured list (R-9). */
export const taskPriorityCodeSchema = snakeCodeSchema;
export type TaskPriorityCode = z.infer<typeof taskPriorityCodeSchema>;

/** The priorities the upgrade seeds, most urgent first (FR-024). */
export const TASK_DEFAULT_PRIORITY_CODES = ['urgent', 'high', 'normal', 'low'] as const;

/** `#rrggbb` — a status, priority or tag colour. */
export const taskColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a #rrggbb hex value');

export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_CONTEXT_NOTE_MAX = 200;
/** The most Tasks one `taskWritePort.createMany` call creates (163 research R-22). */
export const TASK_WRITE_PORT_BATCH_MAX = 100;
export const TASK_LIST_LIMIT_MAX = 100;
/** The most Tasks `GET /tasks/mine` answers. */
export const TASK_MINE_MAX = 500;
/** Assignees of one Task (R-2). */
export const TASK_ASSIGNEES_MAX = 20;
/** Tags of one Task (FR-010). */
export const TASK_TAGS_MAX = 50;
/** Record links one create body may carry. */
export const TASK_LINKS_MAX = 20;
/** Levels of sub-tasks, the top-level Task counted (FR-027, R-15). */
export const TASK_HIERARCHY_DEPTH_MAX = 5;
/**
 * The most Tasks one status or priority removal moves to its replacement inside
 * one Command; above it the removal answers 409 `TASK_STATUS_IN_USE_TOO_MANY`
 * (R-1).
 */
export const TASK_STATUS_REASSIGN_MAX = 5_000;
/** One attachment's size; the asset library's own policy also applies (R-7). */
export const TASK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
/**
 * How late a reminder may still be delivered after its moment — after downtime
 * or while Tasks was off. An older one is recorded as expired and not sent
 * (R-17).
 */
export const TASK_REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;
/** Reminders of one Task. */
export const TASK_REMINDERS_MAX = 10;
/** Recipients of one reminder: the caller and up to {@link TASK_ASSIGNEES_MAX} assignees. */
export const TASK_REMINDER_RECIPIENTS_MAX = TASK_ASSIGNEES_MAX + 1;
/** How far before the due moment a relative reminder may fire: 30 days. */
export const TASK_REMINDER_OFFSET_MAX_MINUTES = 30 * 24 * 60;
/** A context owner's own key for a Task it creates (R-19). */
export const TASK_SOURCE_KEY_MAX = 100;
export const TASK_COMMENT_MAX = 20_000;
export const TASK_TAG_NAME_MAX = 64;
export const TASK_STATUS_NAME_MAX = 120;
export const TASK_BOARD_PER_COLUMN_DEFAULT = 25;
export const TASK_BOARD_PER_COLUMN_MAX = 50;

/**
 * A context type — the contributor's own stable code (`project`). snake_case,
 * so it reads the same in a query string, a column and a log line.
 */
export const taskContextTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'A context type is a snake_case code');

const uuid = z.string().uuid();
const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX);
const descriptionSchema = z.string().max(TASK_DESCRIPTION_MAX);
const isoTimestampSchema = z.string();

const unique = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

/** A list of distinct uuids, at most `max`. */
function uuidSet(max: number, what: string) {
  return z
    .array(uuid)
    .max(max)
    .refine(unique, { message: `${what} may be named once each` });
}

/**
 * A query-string field that may repeat. One occurrence arrives as a string and
 * several as an array; both normalise to an array.
 */
function repeatable<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item).max(50).optional(),
  );
}

/** A query-string boolean: `true` / `false` as text, or a real boolean. */
const queryBooleanSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

/** A name per Admin UI language — both are required (FR-012, FR-024). */
export const TaskLocalizedNameSchema = z
  .object({
    en: z.string().trim().min(1).max(TASK_STATUS_NAME_MAX),
    pl: z.string().trim().min(1).max(TASK_STATUS_NAME_MAX),
  })
  .strict();
export type TaskLocalizedName = z.infer<typeof TaskLocalizedNameSchema>;

// ---------------------------------------------------------------------------
// The Task context (163 `data-model.md` §1 — all or nothing)
// ---------------------------------------------------------------------------

/**
 * Where a Task belongs, when it belongs anywhere. **All or nothing**: a type
 * without an id, or an id without a type, is no context — the table's check
 * `(context_type is null) = (context_id is null)` says the same — and a group
 * (a Stage) exists only inside a context. A Task with no context is written as
 * `context: null` or by leaving `context` out.
 */
export const TaskContextSchema = z
  .object({
    contextType: taskContextTypeSchema,
    contextId: uuid,
    contextGroupId: uuid.nullable().optional(),
  })
  .strict();
export type TaskContext = z.infer<typeof TaskContextSchema>;

/**
 * A context as the reader is shown it: what the owner's descriptor says about it.
 *
 * `available: false` when the owner's `describe()` did not describe the id —
 * a record that went away between the visibility check and the description.
 * The context then fails closed: `label` is the sentence "unavailable record"
 * in the reader's language, `href` and `groupLabel` are `null`. A label is
 * never empty.
 */
export const TaskContextSummarySchema = z.object({
  type: z.string(),
  available: z.boolean(),
  label: z.string().min(1),
  href: z.string().nullable(),
  groupLabel: z.string().nullable(),
});
export type TaskContextSummary = z.infer<typeof TaskContextSummarySchema>;

export const TaskContextDetailSchema = TaskContextSummarySchema.extend({
  id: uuid,
  groupId: uuid.nullable(),
  /**
   * The context owner's `canChangeTasks` for this reader: whether they may
   * delete this Task or move it out of its record. `false` for an unavailable
   * context. A screen offers neither when it is `false` (163 T147).
   */
  canChangeTasks: z.boolean(),
});
export type TaskContextDetail = z.infer<typeof TaskContextDetailSchema>;

// ---------------------------------------------------------------------------
// Record links (R-16)
// ---------------------------------------------------------------------------

/** The records a Task may be linked to besides its context (FR-031). */
export const TASK_LINK_KINDS = ['opportunity', 'order', 'quote_request'] as const;
export const taskLinkKindSchema = z.enum(TASK_LINK_KINDS);
export type TaskLinkKind = z.infer<typeof taskLinkKindSchema>;

export const TaskLinkTargetSchema = z.object({ kind: taskLinkKindSchema, id: uuid }).strict();
export type TaskLinkTarget = z.infer<typeof TaskLinkTargetSchema>;

// ---------------------------------------------------------------------------
// §1 Requests
// ---------------------------------------------------------------------------

/** `assignee`: an admin user's id, `me` (the caller) or `none` (unassigned). Any-of. */
const assigneeFilterSchema = z.union([z.literal('me'), z.literal('none'), uuid]);
/** `creator`: an admin user's id or `me`. */
const creatorFilterSchema = z.union([z.literal('me'), uuid]);
/** `priority`: a code, or `none` for a Task without one. */
const priorityFilterSchema = z.union([z.literal('none'), taskPriorityCodeSchema]);

/** The orders `GET /tasks` sorts by (FR-020, R-12). */
export const TASK_LIST_SORTS = ['created', 'number', 'title', 'due', 'priority', 'status', 'updated'] as const;
export const taskListSortSchema = z.enum(TASK_LIST_SORTS);
export type TaskListSort = z.infer<typeof taskListSortSchema>;
export const taskSortDirectionSchema = z.enum(['asc', 'desc']);
export type TaskSortDirection = z.infer<typeof taskSortDirectionSchema>;

/**
 * The filters the list, *My Tasks* and the board share (FR-020, US3 scenario
 * 4). Unknown status, priority and tag ids **match nothing**; they never answer
 * 422 (R-13) — only a malformed one does.
 */
const taskFilterShape = {
  status: repeatable(taskStatusCodeSchema),
  statusCategory: repeatable(taskStatusCategorySchema),
  assignee: repeatable(assigneeFilterSchema),
  creator: creatorFilterSchema.optional(),
  priority: repeatable(priorityFilterSchema),
  /** Every tag must be carried (AND). */
  tagId: repeatable(uuid),
  dueFrom: calendarDateSchema.optional(),
  dueTo: calendarDateSchema.optional(),
  /** `true`: open Tasks past their due moment (FR-002). */
  overdue: queryBooleanSchema.optional(),
  /** Both or neither. */
  linkedKind: taskLinkKindSchema.optional(),
  linkedId: uuid.optional(),
  contextType: taskContextTypeSchema.optional(),
  contextId: uuid.optional(),
  parentId: uuid.optional(),
  isSubtask: queryBooleanSchema.optional(),
  hasSubtasks: queryBooleanSchema.optional(),
  /** Only ever the caller's own drafts (R-3). */
  draft: queryBooleanSchema.optional(),
  private: queryBooleanSchema.optional(),
  customFieldFilters: customFieldFiltersQueryParamSchema,
  /** Number or title. */
  q: z.string().trim().max(200).optional(),
};

function linkedBothOrNeither(query: { linkedKind?: unknown; linkedId?: unknown }): boolean {
  return (query.linkedKind === undefined) === (query.linkedId === undefined);
}
const LINKED_MESSAGE = { message: 'linkedKind and linkedId go together', path: ['linkedKind'] };

/** `GET /tasks` — keyset paging on any sort (R-12). Hidden Tasks are pre-filtered (R-3). */
export const TaskListQuerySchema = z
  .object({
    ...taskFilterShape,
    sort: taskListSortSchema.optional(),
    dir: taskSortDirectionSchema.optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().positive().max(TASK_LIST_LIMIT_MAX).default(50),
    /**
     * `true`: each row carries the board's card fields (`cardFields`), as a
     * board card does — what a lane's further cards are read with (R-11).
     */
    cardValues: queryBooleanSchema.optional(),
  })
  .refine(linkedBothOrNeither, LINKED_MESSAGE);
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

/**
 * `GET /tasks/mine` — the list's filters, with `assignee=me`,
 * `statusCategory=open` and no draft implied (so those three are not taken).
 */
export const MyTasksQuerySchema = z
  .object({
    ...taskFilterShape,
    assignee: z.undefined().optional(),
    statusCategory: z.undefined().optional(),
    draft: z.undefined().optional(),
    sort: taskListSortSchema.optional(),
    dir: taskSortDirectionSchema.optional(),
  })
  .strict()
  .refine(linkedBothOrNeither, LINKED_MESSAGE);
export type MyTasksQuery = z.infer<typeof MyTasksQuerySchema>;

/**
 * `GET /tasks/board` — the list's filters without cursor and sort: a column is
 * ordered by the board, and further cards come from `GET /tasks?status=` (R-11).
 */
export const TaskBoardQuerySchema = z
  .object({
    ...taskFilterShape,
    perColumn: z.coerce
      .number()
      .int()
      .min(1)
      .max(TASK_BOARD_PER_COLUMN_MAX)
      .default(TASK_BOARD_PER_COLUMN_DEFAULT),
  })
  .strict()
  .refine(linkedBothOrNeither, LINKED_MESSAGE);
export type TaskBoardQuery = z.infer<typeof TaskBoardQuerySchema>;

/** The fields `POST /tasks` and `PATCH /tasks/:id` share. */
const taskFieldShape = {
  title: titleSchema,
  /** Rich text: the `record-rich-text` Markdown subset plus reference tokens (R-4). */
  description: descriptionSchema,
  assigneeIds: uuidSet(TASK_ASSIGNEES_MAX, 'An assignee'),
  /** A date without a time. Exclusive with {@link dueAt}. */
  dueOn: calendarDateSchema.nullable(),
  /** A moment; `dueOn` is derived from it in `tasks.time_zone` (R-17). */
  dueAt: isoDateTimeSchema.nullable(),
  startOn: calendarDateSchema.nullable(),
  priorityCode: taskPriorityCodeSchema.nullable(),
  /** The whole set, replaced. */
  tagIds: uuidSet(TASK_TAGS_MAX, 'A tag'),
  /** Validated against the `task` host's definitions (R-8). */
  customFieldValues: customFieldValuesSchema,
  context: TaskContextSchema.nullable(),
  parentTaskId: uuid.nullable(),
  /** Visible to the Creator and to holders of `tasks:see_private` only; never in a context (FR-038). */
  private: z.boolean(),
};

function notBothDue(body: { dueOn?: string | null | undefined; dueAt?: string | null | undefined }): boolean {
  return !(body.dueOn != null && body.dueAt != null);
}
const BOTH_DUE_MESSAGE = { message: 'A due date and a due moment are exclusive', path: ['dueAt'] };

/**
 * `POST /tasks`. A `context` is accepted only for a type registered by a
 * present module whose descriptor lists the id as visible to the caller — else
 * 422 `TASK_CONTEXT_INVALID`. Each assignee must be an active administrator
 * holding `tasks:read` — else 422 `TASK_ASSIGNEE_INVALID`. A new Task starts in
 * the workflow's initial status (FR-015).
 */
export const CreateTaskBodySchema = z
  .object({
    ...taskFieldShape,
    description: descriptionSchema.optional(),
    assigneeIds: taskFieldShape.assigneeIds.optional(),
    dueOn: taskFieldShape.dueOn.optional(),
    dueAt: taskFieldShape.dueAt.optional(),
    startOn: taskFieldShape.startOn.optional(),
    priorityCode: taskFieldShape.priorityCode.optional(),
    tagIds: taskFieldShape.tagIds.optional(),
    customFieldValues: taskFieldShape.customFieldValues.optional(),
    context: taskFieldShape.context.optional(),
    parentTaskId: taskFieldShape.parentTaskId.optional(),
    private: taskFieldShape.private.optional(),
    links: z.array(TaskLinkTargetSchema).max(TASK_LINKS_MAX).optional(),
    /** Visible to the Creator only until published; one-way (FR-037). */
    draft: z.boolean().optional(),
  })
  .strict()
  .refine(notBothDue, BOTH_DUE_MESSAGE)
  .refine((body) => !(body.private === true && body.context != null), {
    message: 'A private Task has no context',
    path: ['private'],
  });
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;

/**
 * `PATCH /tasks/:id` — any of the fields, at least one. `assigneeIds` replaces
 * the set; `addAssigneeIds` / `removeAssigneeIds` change it, and the two forms
 * are exclusive. **`status` is not accepted**: a status change goes through
 * `POST /tasks/:id/status`, which checks the workflow (R-1). Publishing goes
 * through `POST /tasks/:id/publish`, so `draft` is not accepted either.
 */
export const UpdateTaskBodySchema = z
  .object({
    ...taskFieldShape,
    addAssigneeIds: uuidSet(TASK_ASSIGNEES_MAX, 'An assignee'),
    removeAssigneeIds: uuidSet(TASK_ASSIGNEES_MAX, 'An assignee'),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' })
  .refine(notBothDue, BOTH_DUE_MESSAGE)
  .refine(
    (body) =>
      body.assigneeIds === undefined || (body.addAssigneeIds === undefined && body.removeAssigneeIds === undefined),
    { message: 'Replace the assignees or change them, not both', path: ['assigneeIds'] },
  );
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;

/**
 * `POST /tasks/:id/status` — `from` is the status the caller saw; a Task that
 * moved meanwhile answers 409 `TASK_TRANSITION_CONFLICT` (R-1).
 */
export const TaskStatusChangeBodySchema = z
  .object({ to: taskStatusCodeSchema, from: taskStatusCodeSchema })
  .strict();
export type TaskStatusChangeBody = z.infer<typeof TaskStatusChangeBodySchema>;

// ---------------------------------------------------------------------------
// §2 Collaboration requests
// ---------------------------------------------------------------------------

const commentBodySchema = z.string().trim().min(1).max(TASK_COMMENT_MAX);

/** `POST /tasks/:id/comments` — rich text with references, as the description (R-6). */
export const CreateTaskCommentBodySchema = z.object({ body: commentBodySchema }).strict();
export type CreateTaskCommentBody = z.infer<typeof CreateTaskCommentBodySchema>;

/** `PATCH /tasks/:id/comments/:commentId` — the author only. */
export const UpdateTaskCommentBodySchema = z.object({ body: commentBodySchema }).strict();
export type UpdateTaskCommentBody = z.infer<typeof UpdateTaskCommentBodySchema>;

/** `POST /tasks/:id/attachments` with an asset already in the library (the upload is multipart). */
export const CreateTaskAttachmentBodySchema = z.object({ assetId: uuid }).strict();
export type CreateTaskAttachmentBody = z.infer<typeof CreateTaskAttachmentBodySchema>;

/** `POST /tasks/:id/links`. 422 `TASK_LINK_INVALID` when the record cannot be linked (R-16). */
export const CreateTaskLinkBodySchema = TaskLinkTargetSchema;
export type CreateTaskLinkBody = z.infer<typeof CreateTaskLinkBodySchema>;

/**
 * `POST /tasks/:id/reminders` — at a moment (`remindAt`) **or** some minutes
 * before the due moment (`offsetMinutes`), never both, for 1–21 distinct
 * recipients drawn from the caller and the assignees (R-17). A relative
 * reminder on a Task without a due moment answers 422 `TASK_REMINDER_INVALID`.
 */
export const CreateTaskReminderBodySchema = z
  .object({
    remindAt: isoDateTimeSchema.optional(),
    offsetMinutes: z.number().int().min(0).max(TASK_REMINDER_OFFSET_MAX_MINUTES).optional(),
    recipientIds: z
      .array(uuid)
      .min(1)
      .max(TASK_REMINDER_RECIPIENTS_MAX)
      .refine(unique, { message: 'A recipient may be named once' }),
  })
  .strict()
  .refine((body) => (body.remindAt === undefined) !== (body.offsetMinutes === undefined), {
    message: 'A reminder is at a moment or relative to the due moment',
    path: ['remindAt'],
  });
export type CreateTaskReminderBody = z.infer<typeof CreateTaskReminderBodySchema>;

// ---------------------------------------------------------------------------
// §3 Lookups
// ---------------------------------------------------------------------------

const lookupSearchSchema = z.string().trim().max(200).optional();

/**
 * `GET /tasks/lookups/assignees?q=&taskId=&contextType=&contextId=` — active
 * administrators holding `tasks:read` who may see the Task; only the Creator
 * for a private one. A context (both of its parts, or neither) narrows the
 * answer to who may see that record — the create form's `?context=`, before
 * there is a Task (issue #506); the caller must see the record themselves.
 */
export const TaskAssigneeLookupQuerySchema = z
  .object({
    q: lookupSearchSchema,
    taskId: uuid.optional(),
    contextType: taskContextTypeSchema.optional(),
    contextId: uuid.optional(),
  })
  .refine((query) => (query.contextType === undefined) === (query.contextId === undefined), {
    message: 'A context is its type and its id together.',
    path: ['contextId'],
  });
export type TaskAssigneeLookupQuery = z.infer<typeof TaskAssigneeLookupQuerySchema>;

/** `GET /tasks/lookups/mentionable?taskId=&q=` — at most 20 (R-5). */
export const TaskMentionableLookupQuerySchema = z.object({
  taskId: uuid.optional(),
  q: lookupSearchSchema,
});
export type TaskMentionableLookupQuery = z.infer<typeof TaskMentionableLookupQuerySchema>;

/** `GET /tasks/lookups/documents?q=` — answers `RecordDocumentLookupResponse`. */
export const TaskDocumentLookupQuerySchema = z.object({ q: lookupSearchSchema });
export type TaskDocumentLookupQuery = z.infer<typeof TaskDocumentLookupQuerySchema>;

/** `GET /tasks/lookups/records?kind=&q=` — link targets (R-16). */
export const TaskRecordLookupQuerySchema = z.object({ kind: taskLinkKindSchema, q: lookupSearchSchema });
export type TaskRecordLookupQuery = z.infer<typeof TaskRecordLookupQuerySchema>;

/** `GET /tasks/lookups/contexts?q=` — the Project/Stage picker through each present descriptor. */
export const TaskContextLookupQuerySchema = z.object({ q: lookupSearchSchema });
export type TaskContextLookupQuery = z.infer<typeof TaskContextLookupQuerySchema>;

// ---------------------------------------------------------------------------
// §4 Configuration requests
// ---------------------------------------------------------------------------

const weightSchema = z.number().int().min(0).max(100_000);

/** `POST /tasks/statuses`. `code` is immutable once created. */
export const CreateTaskStatusBodySchema = z
  .object({
    code: taskStatusCodeSchema,
    name: TaskLocalizedNameSchema,
    category: taskStatusCategorySchema,
    color: taskColorSchema,
    weight: weightSchema,
    isInitial: z.boolean().optional(),
  })
  .strict();
export type CreateTaskStatusBody = z.infer<typeof CreateTaskStatusBodySchema>;

/** `PATCH /tasks/statuses/:code` — every field but the code, at least one. */
export const UpdateTaskStatusBodySchema = z
  .object({
    name: TaskLocalizedNameSchema,
    category: taskStatusCategorySchema,
    color: taskColorSchema,
    weight: weightSchema,
    isInitial: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateTaskStatusBody = z.infer<typeof UpdateTaskStatusBodySchema>;

/**
 * `DELETE /tasks/statuses/:code?replacement=` — required when the status is in
 * use; it must be reachable. Above {@link TASK_STATUS_REASSIGN_MAX} Tasks the
 * removal answers 409 `TASK_STATUS_IN_USE_TOO_MANY` (FR-016, R-1).
 */
export const DeleteTaskStatusQuerySchema = z.object({ replacement: taskStatusCodeSchema.optional() });
export type DeleteTaskStatusQuery = z.infer<typeof DeleteTaskStatusQuerySchema>;

export const TaskTransitionEdgeSchema = z
  .object({ from: taskStatusCodeSchema, to: taskStatusCodeSchema })
  .strict()
  .refine((edge) => edge.from !== edge.to, { message: 'A transition connects two different statuses' });
export type TaskTransitionEdge = z.infer<typeof TaskTransitionEdgeSchema>;

/**
 * `PUT /tasks/transitions` — a delta. The answer is the whole workflow; an
 * invalid result answers 422 `TASK_WORKFLOW_INVALID {rule}` and changes nothing.
 */
export const SetTaskTransitionsBodySchema = z
  .object({
    add: z.array(TaskTransitionEdgeSchema).max(500).optional(),
    remove: z.array(TaskTransitionEdgeSchema).max(500).optional(),
  })
  .strict()
  .refine((body) => (body.add?.length ?? 0) + (body.remove?.length ?? 0) > 0, {
    message: 'Add or remove at least one transition',
  });
export type SetTaskTransitionsBody = z.infer<typeof SetTaskTransitionsBodySchema>;

/** `POST /tasks/priorities`. Lower weight is more urgent (R-9). */
export const CreateTaskPriorityBodySchema = z
  .object({
    code: taskPriorityCodeSchema.refine((code) => code !== 'none', {
      message: '`none` is the filter token for a Task without a priority',
    }),
    name: TaskLocalizedNameSchema,
    color: taskColorSchema,
    weight: weightSchema,
  })
  .strict();
export type CreateTaskPriorityBody = z.infer<typeof CreateTaskPriorityBodySchema>;

export const UpdateTaskPriorityBodySchema = z
  .object({ name: TaskLocalizedNameSchema, color: taskColorSchema, weight: weightSchema })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateTaskPriorityBody = z.infer<typeof UpdateTaskPriorityBodySchema>;

/**
 * `PUT /tasks/statuses/order` and `PUT /tasks/priorities/order` (issue #1560)
 * — the whole list in its new order, one Command. `orderedCodes` names
 * must be exactly the configured codes, each once: anything else — a code that
 * is not configured, a row left out, one named twice — answers 409
 * `ORDER_STALE` (the list changed under the caller; reload it). Duplicates are
 * therefore not refused by the schema.
 */
export const ReorderTaskStatusesBodySchema = z
  .object({ orderedCodes: z.array(taskStatusCodeSchema).min(1).max(500) })
  .strict();
export type ReorderTaskStatusesBody = z.infer<typeof ReorderTaskStatusesBodySchema>;

export const ReorderTaskPrioritiesBodySchema = z
  .object({ orderedCodes: z.array(taskPriorityCodeSchema).min(1).max(500) })
  .strict();
export type ReorderTaskPrioritiesBody = z.infer<typeof ReorderTaskPrioritiesBodySchema>;

/** `DELETE /tasks/priorities/:code?replacement=` — a code, or `none` to clear it (FR-024). */
export const DeleteTaskPriorityQuerySchema = z.object({ replacement: priorityFilterSchema.optional() });
export type DeleteTaskPriorityQuery = z.infer<typeof DeleteTaskPriorityQuerySchema>;

/** The colour a tag gets when none is chosen. */
export const TASK_TAG_DEFAULT_COLOR = '#64748b';

const tagNameSchema = z.string().trim().min(1).max(TASK_TAG_NAME_MAX);

/** `POST /tasks/tags`. A taken name, case-insensitively, answers 409 `TASK_TAG_NAME_TAKEN`. */
export const CreateTaskTagBodySchema = z
  .object({ name: tagNameSchema, color: taskColorSchema.optional() })
  .strict();
export type CreateTaskTagBody = z.infer<typeof CreateTaskTagBodySchema>;

export const UpdateTaskTagBodySchema = z
  .object({ name: tagNameSchema, color: taskColorSchema })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateTaskTagBody = z.infer<typeof UpdateTaskTagBodySchema>;

/** How many fields a board card shows at most, the title besides (R-11). */
export const TASK_BOARD_CARD_MAX_FIELDS = 6;

/** The fields every Task has that a board card can show, in the order they are offered. */
export const TASK_BOARD_BUILTIN_FIELD_KEYS = [
  'number',
  'assignees',
  'due',
  'priority',
  'tags',
  'startOn',
  'context',
  'subtasks',
  'createdAt',
  'updatedAt',
] as const;
export type TaskBoardBuiltinFieldKey = (typeof TASK_BOARD_BUILTIN_FIELD_KEYS)[number];

/** `builtin:<key>` or `custom:<definition key>` — CRM's grammar. */
export const taskBoardFieldRefSchema = z
  .string()
  .regex(/^(builtin:[A-Za-z]{1,40}|custom:[a-z][a-z0-9_]{0,63})$/, 'Not a board field reference');

/** The `tasks.board_card_fields` default (`data-model.md` §4). */
export const TASK_BOARD_DEFAULT_CARD_FIELDS: readonly string[] = [
  'builtin:number',
  'builtin:assignees',
  'builtin:due',
  'builtin:priority',
  'builtin:tags',
];

/** `PUT /tasks/board/card-fields`. Validated against the catalogue and the `task` definitions. */
export const SetTaskBoardCardFieldsBodySchema = z
  .object({
    fields: z
      .array(taskBoardFieldRefSchema)
      .max(TASK_BOARD_CARD_MAX_FIELDS)
      .refine(unique, { message: 'A field can be shown once' }),
  })
  .strict();
export type SetTaskBoardCardFieldsBody = z.infer<typeof SetTaskBoardCardFieldsBodySchema>;

/** `PUT /tasks/settings/time-zone` — an IANA name, validated by the server (R-17). */
export const SetTaskTimeZoneBodySchema = z.object({ timeZone: z.string().trim().min(1).max(64) }).strict();
export type SetTaskTimeZoneBody = z.infer<typeof SetTaskTimeZoneBodySchema>;

// ---------------------------------------------------------------------------
// §5 Per-admin requests
// ---------------------------------------------------------------------------

/** `PUT /tasks/me/digest` — on, at a local hour of `tasks.time_zone` (R-18). Off is `DELETE`. */
export const SetTaskDigestBodySchema = z.object({ hour: z.number().int().min(0).max(23) }).strict();
export type SetTaskDigestBody = z.infer<typeof SetTaskDigestBodySchema>;

// Saved views (`/tasks/list-views`) use `createTaskSavedViewRequestSchema` of `saved-list-views.ts`.

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const TaskAssigneeSchema = z.object({
  id: uuid,
  name: z.string(),
  /** `false` once the administrator was deactivated; the Task keeps them. */
  active: z.boolean(),
});
export type TaskAssignee = z.infer<typeof TaskAssigneeSchema>;

/** A status as a reader is shown it: its name in the reader's language. */
export const TaskStatusRefSchema = z.object({
  code: z.string(),
  name: z.string(),
  color: z.string(),
  category: taskStatusCategorySchema,
});
export type TaskStatusRef = z.infer<typeof TaskStatusRefSchema>;

export const TaskPriorityRefSchema = z.object({
  code: z.string(),
  name: z.string(),
  color: z.string(),
});
export type TaskPriorityRef = z.infer<typeof TaskPriorityRefSchema>;

export const TaskTagRefSchema = z.object({ id: uuid, name: z.string(), color: z.string() });
export type TaskTagRef = z.infer<typeof TaskTagRefSchema>;

/** A parent the reader may not see is `available: false` with its number withheld. */
export const TaskParentRefSchema = z.object({
  id: uuid,
  number: z.string().nullable(),
  available: z.boolean(),
});
export type TaskParentRef = z.infer<typeof TaskParentRefSchema>;

/** One field of a board card, as configured (`tasks.board_card_fields`). */
export const TaskCardFieldValueSchema = z.object({
  ref: z.string(),
  value: z.unknown(),
});
export type TaskCardFieldValue = z.infer<typeof TaskCardFieldValueSchema>;

export const TaskSummarySchema = z.object({
  id: uuid,
  number: z.string(),
  title: z.string(),
  status: TaskStatusRefSchema,
  /** Category `done` or `cancelled` (FR-017). */
  closed: z.boolean(),
  assignees: z.array(TaskAssigneeSchema),
  dueOn: z.string().nullable(),
  dueAt: isoTimestampSchema.nullable(),
  /** Open and past the due moment, in `tasks.time_zone` for a date only (FR-002). */
  overdue: z.boolean(),
  priority: TaskPriorityRefSchema.nullable(),
  tags: z.array(TaskTagRefSchema),
  context: TaskContextSummarySchema.nullable(),
  parent: TaskParentRefSchema.nullable(),
  /** Among the sub-tasks the reader may see (FR-028). */
  subtasks: z.object({ closed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  draft: z.boolean(),
  private: z.boolean(),
  /** On the board only: the configured card fields, in order. */
  cardFields: z.array(TaskCardFieldValueSchema).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

/** A record link as the reader is shown it — resolved per reader, like a reference (R-16). */
export const TaskLinkSchema = z.object({
  /** The link's own id — what `DELETE /tasks/:id/links/:linkId` takes. */
  id: uuid,
  kind: taskLinkKindSchema,
  recordId: uuid,
  available: z.boolean(),
  label: z.string().nullable(),
  url: z.string().nullable(),
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const TaskPersonSchema = z.object({ id: uuid, name: z.string() });
export type TaskPerson = z.infer<typeof TaskPersonSchema>;

export const TaskReminderSchema = z.object({
  id: uuid,
  mode: z.enum(['absolute', 'relative']),
  remindAt: isoTimestampSchema,
  offsetMinutes: z.number().int().nullable(),
  recipients: z.array(TaskAssigneeSchema),
  createdBy: TaskPersonSchema.nullable(),
  /** Whether the moment has passed and it was handled for every recipient. */
  done: z.boolean(),
  createdAt: isoTimestampSchema,
});
export type TaskReminder = z.infer<typeof TaskReminderSchema>;

export const TaskDetailSchema = TaskSummarySchema.extend({
  /** Rich text with reference tokens (R-4). */
  description: z.string(),
  /** What the description's reference tokens name for this reader (`record-references.ts`). */
  references: z.array(RecordReferenceSchema),
  context: TaskContextDetailSchema.nullable(),
  /**
   * Written by the context's owner when it created the Task, in the reader's
   * language — e.g. "Responsible role: Installer" (`TaskContextDescriptor.renderNote`).
   */
  contextNote: z.string().nullable(),
  startOn: z.string().nullable(),
  customFieldValues: z.record(z.string(), z.unknown()),
  links: z.array(TaskLinkSchema),
  relatedTasks: z.array(TaskSummarySchema),
  /** The visible sub-tasks themselves; `subtasks` keeps the counts. */
  subtaskItems: z.array(TaskSummarySchema),
  attachmentsCount: z.number().int().nonnegative(),
  commentsCount: z.number().int().nonnegative(),
  /** Only the caller's own reminders and those that name the caller. */
  reminders: z.array(TaskReminderSchema),
  createdBy: TaskPersonSchema.nullable(),
  publishedAt: isoTimestampSchema.nullable(),
  completedAt: isoTimestampSchema.nullable(),
  permissions: z.object({
    /** `false` for a context that refuses changes and for someone else's private Task. */
    canChange: z.boolean(),
    canDelete: z.boolean(),
    /** The Creator of a draft. */
    canPublish: z.boolean(),
  }),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** `GET /tasks` — one page; `nextCursor` is `null` on the last. */
export const TaskListResponseSchema = z.object({
  items: z.array(TaskSummarySchema),
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable().optional(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskBoardColumnSchema = z.object({
  status: TaskStatusRefSchema,
  /** Every visible Task in the column under the filters, not only those sent. */
  count: z.number().int().nonnegative(),
  items: z.array(TaskSummarySchema),
  hasMore: z.boolean(),
});
export type TaskBoardColumn = z.infer<typeof TaskBoardColumnSchema>;

/** `GET /tasks/board` — one column per status, in workflow order (FR-019). */
export const TaskBoardSchema = z.object({ columns: z.array(TaskBoardColumnSchema) });
export type TaskBoard = z.infer<typeof TaskBoardSchema>;

/** `POST /tasks/:id/status`. `openSubtasks` > 0 drives the warning on closing a parent (FR-028). */
export const TaskStatusChangeResultSchema = z.object({
  task: TaskDetailSchema,
  openSubtasks: z.number().int().nonnegative(),
});
export type TaskStatusChangeResult = z.infer<typeof TaskStatusChangeResultSchema>;

/** What deleting a Task did beyond the Task: its sub-tasks became top-level (FR-029). */
export const TaskDeleteResultSchema = z.object({ subtasksDetached: z.number().int().nonnegative() });
export type TaskDeleteResult = z.infer<typeof TaskDeleteResultSchema>;

export const TaskAssigneeOptionSchema = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
});
export type TaskAssigneeOption = z.infer<typeof TaskAssigneeOptionSchema>;

export const TaskCommentSchema = z.object({
  id: uuid,
  author: TaskPersonSchema.nullable(),
  /** Empty once deleted; the thread shows that it was (R-6). */
  body: z.string(),
  references: z.array(RecordReferenceSchema),
  editedAt: isoTimestampSchema.nullable(),
  deletedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const TaskAttachmentSchema = z.object({
  id: uuid,
  assetId: uuid,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string().nullable(),
  uploadedBy: TaskPersonSchema.nullable(),
  createdAt: isoTimestampSchema,
});
export type TaskAttachment = z.infer<typeof TaskAttachmentSchema>;

/** A link target or a context the picker offers. */
export const TaskLookupOptionSchema = z.object({
  id: uuid,
  label: z.string(),
  sublabel: z.string().optional(),
});
export type TaskLookupOption = z.infer<typeof TaskLookupOptionSchema>;

/** `GET /tasks/lookups/contexts` — a context with its groups (a Project with its Stages). */
export const TaskContextOptionSchema = z.object({
  contextType: z.string(),
  id: uuid,
  label: z.string(),
  groups: z.array(z.object({ id: uuid, label: z.string() })),
});
export type TaskContextOption = z.infer<typeof TaskContextOptionSchema>;

/** A status as the workflow page shows it: every language, and how many visible Tasks hold it. */
export const TaskStatusConfigSchema = z.object({
  code: z.string(),
  name: z.record(z.string(), z.string()),
  defaultName: z.string(),
  category: taskStatusCategorySchema,
  isInitial: z.boolean(),
  weight: z.number().int(),
  color: z.string(),
  inUseCount: z.number().int().nonnegative(),
});
export type TaskStatusConfig = z.infer<typeof TaskStatusConfigSchema>;

/** `GET /tasks/workflow`, and the answer of every workflow write. */
export const TaskWorkflowSchema = z.object({
  statuses: z.array(TaskStatusConfigSchema),
  transitions: z.array(z.object({ from: z.string(), to: z.string() })),
});
export type TaskWorkflow = z.infer<typeof TaskWorkflowSchema>;

export const TaskPriorityConfigSchema = z.object({
  code: z.string(),
  name: z.record(z.string(), z.string()),
  defaultName: z.string(),
  color: z.string(),
  weight: z.number().int(),
  inUseCount: z.number().int().nonnegative(),
});
export type TaskPriorityConfig = z.infer<typeof TaskPriorityConfigSchema>;

export const TaskTagSchema = z.object({
  id: uuid,
  name: z.string(),
  color: z.string(),
  usageCount: z.number().int().nonnegative(),
});
export type TaskTag = z.infer<typeof TaskTagSchema>;

export const TaskBoardCardFieldSchema = z.object({
  ref: taskBoardFieldRefSchema,
  source: z.enum(['builtin', 'custom']),
  key: z.string(),
  /** A custom field's labels per language; empty for a built-in field, which the Admin UI names. */
  label: z.record(z.string(), z.string()),
  labelDefault: z.string().nullable(),
});
export type TaskBoardCardField = z.infer<typeof TaskBoardCardFieldSchema>;

export const TaskBoardCardConfigSchema = z.object({
  /** The stored choice, resolved, in order. */
  fields: z.array(TaskBoardCardFieldSchema),
  /** Everything that can be chosen. */
  available: z.array(TaskBoardCardFieldSchema),
  maxFields: z.number().int().positive(),
});
export type TaskBoardCardConfig = z.infer<typeof TaskBoardCardConfigSchema>;

export const TaskTimeZoneSchema = z.object({ timeZone: z.string() });
export type TaskTimeZone = z.infer<typeof TaskTimeZoneSchema>;

/** `GET /tasks/me/digest` — `null` while the digest is off (the default, Q3 = A). */
export const TaskDigestSubscriptionSchema = z.object({ hour: z.number().int().min(0).max(23) }).nullable();
export type TaskDigestSubscription = z.infer<typeof TaskDigestSubscriptionSchema>;

export const TaskDetailResponseSchema = dataEnvelope(TaskDetailSchema);
/** `GET /tasks/mine` — the caller's open Tasks, by due date, undated last; at most {@link TASK_MINE_MAX}. */
export const MyTasksResponseSchema = dataEnvelope(z.array(TaskSummarySchema));
export const TaskBoardResponseSchema = dataEnvelope(TaskBoardSchema);
export const TaskStatusChangeResponseSchema = dataEnvelope(TaskStatusChangeResultSchema);
export const TaskAssigneeLookupResponseSchema = dataEnvelope(z.array(TaskAssigneeOptionSchema));
export const TaskMentionableLookupResponseSchema = dataEnvelope(z.array(TaskAssigneeOptionSchema));
export const TaskRecordLookupResponseSchema = dataEnvelope(z.array(TaskLookupOptionSchema));
export const TaskContextLookupResponseSchema = dataEnvelope(z.array(TaskContextOptionSchema));
export const TaskCommentResponseSchema = dataEnvelope(TaskCommentSchema);
export const TaskCommentListResponseSchema = dataEnvelope(z.array(TaskCommentSchema));
export const TaskAttachmentResponseSchema = dataEnvelope(TaskAttachmentSchema);
export const TaskAttachmentListResponseSchema = dataEnvelope(z.array(TaskAttachmentSchema));
export const TaskLinkResponseSchema = dataEnvelope(TaskLinkSchema);
export const TaskReminderResponseSchema = dataEnvelope(TaskReminderSchema);
export const TaskReminderListResponseSchema = dataEnvelope(z.array(TaskReminderSchema));
export const TaskWorkflowResponseSchema = dataEnvelope(TaskWorkflowSchema);
export const TaskPriorityListResponseSchema = dataEnvelope(z.array(TaskPriorityConfigSchema));
export const TaskPriorityResponseSchema = dataEnvelope(TaskPriorityConfigSchema);
export const TaskTagListResponseSchema = dataEnvelope(z.array(TaskTagSchema));
export const TaskTagResponseSchema = dataEnvelope(TaskTagSchema);
export const TaskBoardCardConfigResponseSchema = dataEnvelope(TaskBoardCardConfigSchema);
export const TaskTimeZoneResponseSchema = dataEnvelope(TaskTimeZoneSchema);
export const TaskDigestSubscriptionResponseSchema = dataEnvelope(TaskDigestSubscriptionSchema);
export const TaskDeleteResponseSchema = dataEnvelope(TaskDeleteResultSchema);
// `GET /tasks/:id/history` answers `RecordHistoryPageSchema` of `record-references.ts`;
// `GET /tasks/lookups/documents` answers `RecordDocumentLookupResponseSchema`.

// ---------------------------------------------------------------------------
// Error codes (`contracts/admin-api.md`, research R-20)
// ---------------------------------------------------------------------------

/**
 * The codes the Tasks API raises. Each joins the platform's `ERROR_CODES`, the
 * `tasks` manifest's `errorCodes` and the module's `errors.<CODE>` sentences in
 * the change that adds its first raise site — `check:error-translations` refuses
 * a code enumerated before a manifest declares it.
 */
export const TASKS_ERROR_CODES = [
  /** No such Task, or one the caller may not see (context, draft, private) — indistinguishable. */
  'TASK_NOT_FOUND',
  /** The context's type is not registered by a present module, or the caller may not see the id. */
  'TASK_CONTEXT_INVALID',
  /** An assignee is not an active administrator holding `tasks:read` who may see the Task. */
  'TASK_ASSIGNEE_INVALID',
  /** A status code that is not in the workflow (422). */
  'TASK_STATUS_UNKNOWN',
  /** A move the workflow does not permit; carries `allowedTargets` (409). */
  'TASK_TRANSITION_FORBIDDEN',
  /** The Task left the status the caller saw (409). */
  'TASK_TRANSITION_CONFLICT',
  /** A workflow change that breaks a FR-013 rule; carries `rule` (422). */
  'TASK_WORKFLOW_INVALID',
  /** A status or priority removal that would move more than {@link TASK_STATUS_REASSIGN_MAX} Tasks (409). */
  'TASK_STATUS_IN_USE_TOO_MANY',
  /** A priority code that is not configured (422). */
  'TASK_PRIORITY_UNKNOWN',
  /** A tag name taken, case-insensitively (409). */
  'TASK_TAG_NAME_TAKEN',
  /** A tag id that does not exist (422). */
  'TASK_TAG_UNKNOWN',
  /** A private Task assigned to someone other than its Creator (422). */
  'TASK_PRIVATE_ASSIGNEE',
  /** A change to someone else's private Task by a holder of `tasks:see_private` (403). */
  'TASK_PRIVATE_READ_ONLY',
  /**
   * Publishing a Task that is not a draft any more (409) — publishing is
   * one-way. Somebody else's draft is not refused with a code of its own: it
   * does not exist for them (404 `TASK_NOT_FOUND`, FR-037, SC-005), so the
   * `TASK_DRAFT_ONLY_CREATOR` the plan named could never be raised (T078).
   */
  'TASK_ALREADY_PUBLISHED',
  /** A parent that would close a cycle (422). */
  'TASK_PARENT_CYCLE',
  /** A parent that would nest deeper than {@link TASK_HIERARCHY_DEPTH_MAX} (422). */
  'TASK_HIERARCHY_TOO_DEEP',
  /** A record that cannot be linked: owner absent, no read permission, or not found (422). */
  'TASK_LINK_INVALID',
  /** An attachment refused: too large or active content (415). */
  'TASK_ATTACHMENT_REFUSED',
  /** A reminder that cannot be set: no due moment, bad recipients, too many (422). */
  'TASK_REMINDER_INVALID',
  /** A saved view name the owner already uses (409). */
  'TASK_VIEW_NAME_TAKEN',
] as const;
export type TasksErrorCode = (typeof TASKS_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Events (`data-model.md` §8)
// ---------------------------------------------------------------------------

/**
 * The `eventId` / `occurredAt` envelope every in-process event carries. Spelled
 * structurally because this package may not import the platform's `EventBase`.
 */
interface TasksEventEnvelope {
  eventId: string;
  occurredAt: string;
}

/** The event names `tasks` emits, once per Command, on commit. Nothing subscribes today. */
export const TASKS_EVENTS = {
  CREATED: 'tasks.task.created.v1',
  STATUS_CHANGED: 'tasks.task.status_changed.v1',
  ASSIGNEES_CHANGED: 'tasks.task.assignees_changed.v1',
  DELETED: 'tasks.task.deleted.v1',
} as const;

/** Payload of `tasks.task.created.v1` — emitted at publication for a draft (R-3). */
export interface TaskCreatedEvent extends TasksEventEnvelope {
  taskId: string;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
  assigneeIds: string[];
}

/** Payload of `tasks.task.status_changed.v1` — codes, and the target's category. */
export interface TaskStatusChangedEvent extends TasksEventEnvelope {
  taskId: string;
  from: string;
  to: string;
  toCategory: TaskStatusCategory;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
}

/** Payload of `tasks.task.assignees_changed.v1`, which replaced `tasks.task.assigned.v1`. */
export interface TaskAssigneesChangedEvent extends TasksEventEnvelope {
  taskId: string;
  added: string[];
  removed: string[];
}

/** Payload of `tasks.task.deleted.v1`. */
export interface TaskDeletedEvent extends TasksEventEnvelope {
  taskId: string;
  contextType: string | null;
  contextId: string | null;
}

// ---------------------------------------------------------------------------
// Published ports and the context registry (`contracts/ports-and-events.md`)
//
// The `Container name:` marker of each was added in the change that registered
// it (`check:port-shape` refuses a marked port nothing registers — CRM
// `research.md` N-5).
// ---------------------------------------------------------------------------

/** A Task as it crosses a module boundary — a plain shape, never the entity. */
export interface TaskRecord {
  id: string;
  number: string;
  title: string;
  /** A code of the workflow. */
  status: string;
  statusCategory: TaskStatusCategory;
  /**
   * The status's name per language and its fallback, and its colour — so a
   * consumer that shows a Task (Projects' Tasks tab) names its status as the
   * Tasks screens do, in its reader's language, without a second port.
   */
  statusName: Record<string, string>;
  statusDefaultName: string;
  statusColor: string;
  /** Category `done` or `cancelled`. */
  closed: boolean;
  dueOn: string | null;
  dueAt: Date | null;
  assigneeIds: string[];
  draft: boolean;
  private: boolean;
  contextType: string | null;
  contextId: string | null;
  contextGroupId: string | null;
  contextNote: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What `TaskReadPort.search` is asked: the letters typed, and how many to answer. */
export interface TaskSearchQuery {
  q?: string;
  limit: number;
}

/** The Tasks of one context, or of one group (a Stage) inside it. */
export interface TaskContextQuery {
  contextType: string;
  contextId: string;
  contextGroupId?: string;
}

/**
 * Container name: `taskReadPort`. Owner: `tasks`.
 *
 * Reading Tasks from another module.
 *
 * Every method applies the **whole** visibility predicate for an
 * administrator's call — context (163 R-9), draft and private (165 R-3) — so a
 * private Task of another admin is absent from CRM's and Projects' references
 * and lookups. A call the system makes (no admin session — a sweep) is not
 * narrowed.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`.
 */
export interface TaskReadPort {
  findById(id: string): Promise<TaskRecord | null>;
  /**
   * The Tasks of `ids` the caller may see, in no particular order — a hidden,
   * missing or malformed id is simply absent. One query for a page of
   * references (`specs/163-projects-and-tasks/` FR-044).
   */
  findByIds(ids: readonly string[]): Promise<TaskRecord[]>;
  /**
   * Tasks the caller may see whose number or title contains `q`
   * (case-insensitively; every visible Task for an empty `q`), newest first,
   * at most `limit` — the Tasks group of the `@@` document list (FR-044).
   */
  search(query: TaskSearchQuery): Promise<TaskRecord[]>;
  listInContext(q: TaskContextQuery): Promise<TaskRecord[]>;
  /** Category `open` and not a draft — the completion gate's question (R-1, R-3). */
  listOpenInContext(q: TaskContextQuery): Promise<TaskRecord[]>;
  countInContext(q: TaskContextQuery): Promise<number>;
}

/**
 * One Task another module asks `tasks` to create in its context. Validated by
 * the port with this schema before the first Command runs.
 */
export const NewContextTaskSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.optional(),
    assigneeIds: uuidSet(TASK_ASSIGNEES_MAX, 'An assignee').optional(),
    dueOn: calendarDateSchema.nullable().optional(),
    /** Overrides the call's `context.contextGroupId` for this Task. */
    contextGroupId: uuid.nullable().optional(),
    contextNote: z.string().max(TASK_CONTEXT_NOTE_MAX).nullable().optional(),
    /**
     * The owner's own key for this Task (a Stage Task definition's id). A key
     * that already exists in the context is not created again: its id is
     * returned in its place, which makes a retry safe (R-19, issue #450).
     */
    sourceKey: z.string().min(1).max(TASK_SOURCE_KEY_MAX).optional(),
  })
  .strict();
export type NewContextTask = z.input<typeof NewContextTaskSchema>;

/**
 * Container name: `taskWritePort`. Owner: `tasks`.
 *
 * Creating and deleting Tasks from another module.
 *
 * `createMany` runs one `tasks.task.create` Command per Task under the ambient
 * actor, at most {@link TASK_WRITE_PORT_BATCH_MAX} per call; the context's type
 * must be registered by a present module. New Tasks start in the workflow's
 * initial status and are published, never drafts. A `sourceKey` already present
 * in the context is skipped and its existing id returned, in input order (R-19).
 * **Call it after your own commit** — the implementation obtains its own
 * EntityManager (163 R-8).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError`. A consumer must not wrap the call in a bare `catch`.
 */
export interface TaskWritePort {
  createMany(input: { context: TaskContext; tasks: NewContextTask[] }): Promise<{ ids: string[] }>;
  /** Every Task of one context — used when the context's record is deleted. */
  deleteInContext(q: { contextType: string; contextId: string }): Promise<{ deleted: number }>;
}

/** How a context is shown on a Task: its label, its address, and its groups' labels. */
export interface TaskContextDescription {
  label: string;
  href: string;
  /** groupId → label (a Project's Stage names). */
  groups: Map<string, string>;
}

/** What `TaskContextDescriptor.search` is asked (issue #504). */
export interface TaskContextSearchQuery {
  /** Trimmed; empty matches every context. */
  q: string;
  /** The most contexts to answer. */
  limit: number;
  /** Only the contexts `canChangeTasks` would answer `true` for. */
  changeableOnly: boolean;
}

/** One context `TaskContextDescriptor.search` found, described as `describe` would. */
export interface TaskContextSearchHit {
  id: string;
  description: TaskContextDescription;
}

/**
 * What a module registers to own Tasks: its context type and the answers only
 * it can give. Every method runs under the **caller's** ambient context.
 */
export interface TaskContextDescriptor {
  /** The context type the module owns (`project`). */
  readonly contextType: string;
  /** The contributing module; an absent owner hides its Tasks. */
  readonly ownerModuleId: string;
  /** Every context id of this type the caller may see — the list pre-filter (163 R-9). */
  allVisibleContextIds(): Promise<string[]>;
  /** Which of `ids` the caller may see. */
  visibleContextIds(ids: readonly string[]): Promise<Set<string>>;
  describe(ids: readonly string[]): Promise<Map<string, TaskContextDescription>>;
  /**
   * The Project/Stage picker's search (`GET /tasks/lookups/contexts`, issue
   * #504): the contexts the caller may see whose label contains `q` — case-
   * and diacritic-insensitively, every one for an empty `q` — by label, at
   * most `limit`, each described as `describe` would describe it; with
   * `changeableOnly`, only those `canChangeTasks` would allow. Its cost is
   * bounded by `limit`, never by how many contexts the caller may see.
   * Without this method `tasks` lists every visible context and describes
   * them all on each search.
   */
  search?(query: TaskContextSearchQuery): Promise<TaskContextSearchHit[]>;
  /**
   * Whether **another** administrator — not the caller — may see context `id`:
   * asked before somebody is told about a Task of it (the assignment bell),
   * because a bell is read outside the context's visibility and a Task's
   * number must not reach somebody its context hides it from. Answered against
   * that administrator's own permissions and reach; `false` when unsure.
   */
  canSeeAs(adminUserId: string, id: string): Promise<boolean>;
  /**
   * Whether the caller may change which Tasks context `id` holds: put a Task
   * **into** it (create it there, or move it there from elsewhere), take one
   * **out of** it (detach it, or move it to another record), or **delete** one
   * of its Tasks. Without this a holder of `tasks:write` who merely sees a
   * record could publish its Tasks to every holder of `tasks:read`, add to its
   * work or remove from it (163 T144, T147). Moving a Task between the groups
   * of one record, and editing a Task where it is, are not asked. Answered
   * under the caller's own context; `false` when unsure.
   */
  canChangeTasks(id: string): Promise<boolean>;
  /**
   * A Task's `contextNote` in the reader's language. The note is the owner's
   * own text, written when it created the Task; an owner that stores a key
   * rather than a sentence (a Project stores the responsible Role) answers it
   * here. Without this method the note is shown as it is stored.
   */
  renderNote?(note: string, language: SupportedLanguage): Promise<string>;
  /**
   * Which of these contexts still exist, and the group ids each has now —
   * regardless of who may see them. Called by `tasks` only under the system
   * actor, from its maintenance pass (R-19, issue #450). A context the owner
   * cannot vouch for must be returned as existing: absence here deletes Tasks.
   * A contributor without the method is never cleaned up.
   */
  existingContexts?(ids: readonly string[]): Promise<Map<string, ReadonlySet<string>>>;
}

/**
 * Container name: `taskContextRegistry`. Owner: `tasks`.
 *
 * The registry a module pushes its {@link TaskContextDescriptor} into.
 *
 * A **contribution seam**: registered ungated (a plain `ctx.di.register`),
 * pushed into from a contribution-only boot hook, declared by the contributor
 * as a `contributes-to` edge.
 *
 * **Enumeration policy: fail-closed.** A Task whose context type is
 * unregistered, or whose owner is not effectively present, is hidden — from
 * lists, counts and by id — and reappears unchanged when the owner is back.
 */
export interface TaskContextRegistryPort {
  register(descriptor: TaskContextDescriptor): void;
}
