import { describe, expect, it } from 'vitest';
import * as tasks from './tasks.js';

/**
 * `specs/165-task-management/contracts/admin-api.md` §1–§5 — one accept and
 * one reject case per request schema of the Tasks API — plus the vocabulary,
 * limits, ports and events of `contracts/ports-and-events.md` and
 * `data-model.md` §8. Feature 163's cases that still hold are kept, on the new
 * shape (statuses as codes, assignees as a list).
 */

const UUID_A = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const UUID_B = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';
const UUID_C = '2c4d6e8f-1a3b-4c5d-8e7f-9a0b1c2d3e03';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

const uuids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('vocabulary and limits', () => {
  it('seeds the four status codes of 163, in order, and three categories', () => {
    expect([...tasks.TASK_DEFAULT_STATUS_CODES]).toEqual(['todo', 'in_progress', 'done', 'cancelled']);
    expect([...tasks.TASK_STATUS_CATEGORIES]).toEqual(['open', 'done', 'cancelled']);
    expect([...tasks.TASK_CLOSED_STATUS_CATEGORIES]).toEqual(['done', 'cancelled']);
  });

  it('a status code is snake_case, starts with a letter and has at most 64 characters', () => {
    accepts(tasks.taskStatusCodeSchema, 'todo');
    accepts(tasks.taskStatusCodeSchema, 'waiting_for_client_2');
    accepts(tasks.taskStatusCodeSchema, 'a'.repeat(64));
    rejects(tasks.taskStatusCodeSchema, 'In Progress');
    rejects(tasks.taskStatusCodeSchema, '2nd');
    rejects(tasks.taskStatusCodeSchema, 'in-progress');
    rejects(tasks.taskStatusCodeSchema, '');
    rejects(tasks.taskStatusCodeSchema, 'a'.repeat(65));
  });

  it('a colour is #rrggbb', () => {
    accepts(tasks.taskColorSchema, '#64748b');
    accepts(tasks.taskColorSchema, '#A0B1C2');
    rejects(tasks.taskColorSchema, '64748b');
    rejects(tasks.taskColorSchema, '#fff');
    rejects(tasks.taskColorSchema, 'red');
  });

  it('states the limits of research R-1, R-2, R-7, R-10, R-15 and R-17', () => {
    expect(tasks.TASK_ASSIGNEES_MAX).toBe(20);
    expect(tasks.TASK_TAGS_MAX).toBe(50);
    expect(tasks.TASK_HIERARCHY_DEPTH_MAX).toBe(5);
    expect(tasks.TASK_STATUS_REASSIGN_MAX).toBe(5_000);
    expect(tasks.TASK_ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(tasks.TASK_REMINDER_GRACE_MS).toBe(24 * 60 * 60 * 1000);
    expect(tasks.TASK_REMINDERS_MAX).toBe(10);
    expect(tasks.TASK_WRITE_PORT_BATCH_MAX).toBe(100);
  });

  it('no longer exports the fixed status list or the closed-status list of 163', () => {
    expect('TASK_STATUSES' in tasks).toBe(false);
    expect('TASK_CLOSED_STATUSES' in tasks).toBe(false);
  });
});

describe('TaskContext — all or nothing (163, unchanged)', () => {
  it('accepts a type and an id, with or without a group', () => {
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A });
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, contextGroupId: UUID_B });
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, contextGroupId: null });
  });

  it('refuses a type without an id, an id without a type, and an unknown key', () => {
    rejects(tasks.TaskContextSchema, { contextType: 'project' });
    rejects(tasks.TaskContextSchema, { contextId: UUID_A });
    rejects(tasks.TaskContextSchema, { contextType: 'Project', contextId: UUID_A });
    rejects(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, projectId: UUID_A });
  });
});

describe('§1 GET /tasks — TaskListQuery (R-12)', () => {
  it('normalises every repeatable filter to an array', () => {
    const parsed = tasks.TaskListQuerySchema.parse({
      status: 'waiting',
      statusCategory: 'open',
      assignee: 'me',
      priority: 'none',
      tagId: UUID_A,
    });
    expect(parsed.status).toEqual(['waiting']);
    expect(parsed.statusCategory).toEqual(['open']);
    expect(parsed.assignee).toEqual(['me']);
    expect(parsed.priority).toEqual(['none']);
    expect(parsed.tagId).toEqual([UUID_A]);
  });

  it('accepts every documented filter, the sorts and both directions', () => {
    const parsed = tasks.TaskListQuerySchema.parse({
      status: ['todo', 'done'],
      statusCategory: ['open', 'cancelled'],
      assignee: ['me', 'none', UUID_B],
      creator: 'me',
      priority: ['urgent', 'none'],
      tagId: [UUID_A, UUID_B],
      dueFrom: '2026-10-01',
      dueTo: '2026-10-31',
      overdue: 'true',
      linkedKind: 'order',
      linkedId: UUID_C,
      contextType: 'project',
      contextId: UUID_A,
      parentId: UUID_B,
      isSubtask: 'false',
      hasSubtasks: 'true',
      draft: 'true',
      private: 'false',
      customFieldFilters: JSON.stringify({ region: { in: ['north'] } }),
      q: 'install',
      sort: 'priority',
      dir: 'asc',
      limit: '25',
    });
    expect(parsed.overdue).toBe(true);
    expect(parsed.isSubtask).toBe(false);
    expect(parsed.customFieldFilters).toEqual({ region: { in: ['north'] } });
    expect(parsed.limit).toBe(25);
    for (const sort of ['created', 'number', 'title', 'due', 'priority', 'status', 'updated']) {
      accepts(tasks.TaskListQuerySchema, { sort, dir: 'desc' });
    }
    expect(tasks.TaskListQuerySchema.parse({}).limit).toBe(50);
    // A board lane's further cards carry the card fields, as the board's do (165 T055).
    expect(tasks.TaskListQuerySchema.parse({ cardValues: 'true' }).cardValues).toBe(true);
    expect(tasks.TaskListQuerySchema.parse({}).cardValues).toBeUndefined();
  });

  it('refuses an unknown sort or direction, a bad category, a malformed code and an unknown assignee token', () => {
    rejects(tasks.TaskListQuerySchema, { sort: 'colour' });
    rejects(tasks.TaskListQuerySchema, { dir: 'up' });
    rejects(tasks.TaskListQuerySchema, { statusCategory: 'closed' });
    rejects(tasks.TaskListQuerySchema, { status: 'In Progress' });
    rejects(tasks.TaskListQuerySchema, { assignee: 'nobody' });
    rejects(tasks.TaskListQuerySchema, { creator: 'none' });
    rejects(tasks.TaskListQuerySchema, { limit: '101' });
  });

  it('refuses a linked kind without an id, an id without a kind, and an unknown kind', () => {
    rejects(tasks.TaskListQuerySchema, { linkedKind: 'order' });
    rejects(tasks.TaskListQuerySchema, { linkedId: UUID_A });
    rejects(tasks.TaskListQuerySchema, { linkedKind: 'project', linkedId: UUID_A });
  });
});

describe('§1 GET /tasks/board — TaskBoardQuery', () => {
  it('takes the list filters and a per-column size, 25 by default and at most 50', () => {
    const parsed = tasks.TaskBoardQuerySchema.parse({ assignee: 'me', perColumn: '10' });
    expect(parsed.perColumn).toBe(10);
    expect(tasks.TaskBoardQuerySchema.parse({}).perColumn).toBe(25);
    accepts(tasks.TaskBoardQuerySchema, { perColumn: '50' });
  });

  it('refuses a per-column size outside 1–50, a cursor and a sort', () => {
    rejects(tasks.TaskBoardQuerySchema, { perColumn: '0' });
    rejects(tasks.TaskBoardQuerySchema, { perColumn: '51' });
    rejects(tasks.TaskBoardQuerySchema, { cursor: 'abc' });
    rejects(tasks.TaskBoardQuerySchema, { sort: 'title' });
  });
});

describe('§1 GET /tasks/count — TaskCountQuery (spec 183)', () => {
  it('takes every list filter, the Tasks tab\'s query among them', () => {
    const parsed = tasks.TaskCountQuerySchema.parse({
      linkedKind: 'opportunity',
      linkedId: UUID_A,
      statusCategory: 'open',
    });
    expect(parsed.statusCategory).toEqual(['open']);
    accepts(tasks.TaskCountQuerySchema, {});
    accepts(tasks.TaskCountQuerySchema, { assignee: ['me', 'none'], tagId: UUID_B, overdue: 'true', q: 'measure' });
  });

  it('refuses paging, sorting and card values', () => {
    rejects(tasks.TaskCountQuerySchema, { limit: '10' });
    rejects(tasks.TaskCountQuerySchema, { cursor: 'abc' });
    rejects(tasks.TaskCountQuerySchema, { sort: 'title' });
    rejects(tasks.TaskCountQuerySchema, { dir: 'asc' });
    rejects(tasks.TaskCountQuerySchema, { cardValues: 'true' });
  });

  it('refuses a half-linked pair', () => {
    rejects(tasks.TaskCountQuerySchema, { linkedKind: 'opportunity' });
    rejects(tasks.TaskCountQuerySchema, { linkedId: UUID_A });
  });

  it('answers a non-negative integer count in a data envelope', () => {
    accepts(tasks.TaskCountResponseSchema, { data: { count: 0 } });
    accepts(tasks.TaskCountResponseSchema, { data: { count: 3 } });
    rejects(tasks.TaskCountResponseSchema, { data: { count: -1 } });
    rejects(tasks.TaskCountResponseSchema, { data: { count: 1.5 } });
    rejects(tasks.TaskCountResponseSchema, { count: 3 });
  });
});

describe('§1 POST /tasks — CreateTaskBody', () => {
  it('accepts a title alone, and every optional field', () => {
    accepts(tasks.CreateTaskBodySchema, { title: 'Measure the showroom' });
    accepts(tasks.CreateTaskBodySchema, {
      title: 'Measure the showroom',
      description: 'Bring the **laser**.',
      assigneeIds: [UUID_A, UUID_B],
      dueAt: '2026-11-03T14:30:00+01:00',
      startOn: '2026-11-01',
      priorityCode: 'high',
      tagIds: [UUID_C],
      customFieldValues: { region: 'north' },
      context: { contextType: 'project', contextId: UUID_B, contextGroupId: UUID_C },
      parentTaskId: UUID_A,
      links: [
        { kind: 'opportunity', id: UUID_A },
        { kind: 'order', id: UUID_B },
        { kind: 'quote_request', id: UUID_C },
      ],
      draft: true,
    });
    accepts(tasks.CreateTaskBodySchema, { title: 'Mine', private: true, dueOn: '2026-11-03' });
  });

  it('refuses a missing or over-long title and an unknown key', () => {
    rejects(tasks.CreateTaskBodySchema, {});
    rejects(tasks.CreateTaskBodySchema, { title: '   ' });
    rejects(tasks.CreateTaskBodySchema, { title: 'x'.repeat(201) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', assignedAdminUserId: UUID_A });
  });

  it('takes at most 20 assignees, each once', () => {
    accepts(tasks.CreateTaskBodySchema, { title: 'x', assigneeIds: uuids(20) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', assigneeIds: uuids(21) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', assigneeIds: [UUID_A, UUID_A] });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', assigneeIds: ['me'] });
  });

  it('takes at most 50 tags, each once', () => {
    accepts(tasks.CreateTaskBodySchema, { title: 'x', tagIds: uuids(50) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', tagIds: uuids(51) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', tagIds: [UUID_A, UUID_A] });
  });

  it('takes a due date or a due moment, never both', () => {
    accepts(tasks.CreateTaskBodySchema, { title: 'x', dueOn: '2026-11-03' });
    accepts(tasks.CreateTaskBodySchema, { title: 'x', dueAt: '2026-11-03T13:30:00Z' });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', dueOn: '2026-11-03', dueAt: '2026-11-03T13:30:00Z' });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', dueAt: '2026-11-03 13:30' });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', dueOn: 'tomorrow' });
  });

  it('takes links to Opportunities, Orders and Quote Requests only, at most 20', () => {
    rejects(tasks.CreateTaskBodySchema, { title: 'x', links: [{ kind: 'project', id: UUID_A }] });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', links: [{ kind: 'order', id: 'ORD-1' }] });
    rejects(tasks.CreateTaskBodySchema, {
      title: 'x',
      links: uuids(21).map((id) => ({ kind: 'order', id })),
    });
  });

  it('refuses a private Task in a context (FR-038)', () => {
    rejects(tasks.CreateTaskBodySchema, {
      title: 'x',
      private: true,
      context: { contextType: 'project', contextId: UUID_A },
    });
  });
});

describe('§1 PATCH /tasks/:id — UpdateTaskBody', () => {
  it('accepts any one field, a replace or a delta of assignees, and clearing what can be cleared', () => {
    accepts(tasks.UpdateTaskBodySchema, { title: 'Renamed' });
    accepts(tasks.UpdateTaskBodySchema, { assigneeIds: [] });
    accepts(tasks.UpdateTaskBodySchema, { addAssigneeIds: [UUID_A], removeAssigneeIds: [UUID_B] });
    accepts(tasks.UpdateTaskBodySchema, { dueOn: null, dueAt: null, priorityCode: null, parentTaskId: null });
    accepts(tasks.UpdateTaskBodySchema, { private: false });
  });

  it('refuses a status — a status change goes through /status', () => {
    rejects(tasks.UpdateTaskBodySchema, { status: 'done' });
  });

  it('refuses an empty body, a replace together with a delta, and both due forms set', () => {
    rejects(tasks.UpdateTaskBodySchema, {});
    rejects(tasks.UpdateTaskBodySchema, { assigneeIds: [UUID_A], addAssigneeIds: [UUID_B] });
    rejects(tasks.UpdateTaskBodySchema, { dueOn: '2026-11-03', dueAt: '2026-11-03T13:30:00Z' });
    rejects(tasks.UpdateTaskBodySchema, { addAssigneeIds: uuids(21) });
    rejects(tasks.UpdateTaskBodySchema, { draft: true });
  });
});

describe('§1 POST /tasks/:id/status — TaskStatusChangeBody', () => {
  it('names the target and the status the caller saw', () => {
    accepts(tasks.TaskStatusChangeBodySchema, { to: 'done', from: 'in_progress' });
  });

  it('refuses a body without `from`, a malformed code and an unknown key', () => {
    rejects(tasks.TaskStatusChangeBodySchema, { to: 'done' });
    rejects(tasks.TaskStatusChangeBodySchema, { to: 'Done', from: 'todo' });
    rejects(tasks.TaskStatusChangeBodySchema, { to: 'done', from: 'todo', reason: 'x' });
  });
});

describe('§2 collaboration', () => {
  it('a comment has 1 to 20 000 characters', () => {
    accepts(tasks.CreateTaskCommentBodySchema, { body: 'Looks good [[task:' + UUID_A + ']]' });
    rejects(tasks.CreateTaskCommentBodySchema, { body: '  ' });
    rejects(tasks.CreateTaskCommentBodySchema, { body: 'x'.repeat(20_001) });
    accepts(tasks.UpdateTaskCommentBodySchema, { body: 'Edited' });
    rejects(tasks.UpdateTaskCommentBodySchema, {});
  });

  it('an attachment by asset id', () => {
    accepts(tasks.CreateTaskAttachmentBodySchema, { assetId: UUID_A });
    rejects(tasks.CreateTaskAttachmentBodySchema, { assetId: 'logo.png' });
  });

  it('a link names one of the three kinds and a uuid', () => {
    accepts(tasks.CreateTaskLinkBodySchema, { kind: 'quote_request', id: UUID_A });
    rejects(tasks.CreateTaskLinkBodySchema, { kind: 'task', id: UUID_A });
  });

  it('a reminder is absolute or relative, never both, for 1 to 21 distinct recipients', () => {
    accepts(tasks.CreateTaskReminderBodySchema, { remindAt: '2026-11-03T08:00:00Z', recipientIds: [UUID_A] });
    accepts(tasks.CreateTaskReminderBodySchema, { offsetMinutes: 60, recipientIds: uuids(21) });
    rejects(tasks.CreateTaskReminderBodySchema, {
      remindAt: '2026-11-03T08:00:00Z',
      offsetMinutes: 60,
      recipientIds: [UUID_A],
    });
    rejects(tasks.CreateTaskReminderBodySchema, { recipientIds: [UUID_A] });
    rejects(tasks.CreateTaskReminderBodySchema, { offsetMinutes: 60, recipientIds: [] });
    rejects(tasks.CreateTaskReminderBodySchema, { offsetMinutes: 60, recipientIds: uuids(22) });
    rejects(tasks.CreateTaskReminderBodySchema, { offsetMinutes: 60, recipientIds: [UUID_A, UUID_A] });
    rejects(tasks.CreateTaskReminderBodySchema, { offsetMinutes: -5, recipientIds: [UUID_A] });
  });
});

describe('§3 lookups', () => {
  it('assignees and mentionable people take a search and a Task', () => {
    accepts(tasks.TaskAssigneeLookupQuerySchema, {});
    accepts(tasks.TaskAssigneeLookupQuerySchema, { q: 'anna', taskId: UUID_A });
    rejects(tasks.TaskAssigneeLookupQuerySchema, { q: 'x'.repeat(201) });
    accepts(tasks.TaskMentionableLookupQuerySchema, { taskId: UUID_A, q: 'an' });
    rejects(tasks.TaskMentionableLookupQuerySchema, { taskId: 'TSK-1' });
  });

  it('records are looked up per link kind', () => {
    accepts(tasks.TaskRecordLookupQuerySchema, { kind: 'opportunity', q: 'OPP' });
    rejects(tasks.TaskRecordLookupQuerySchema, { kind: 'product', q: 'x' });
  });
});

describe('§4 configuration', () => {
  const status = { code: 'waiting', name: { en: 'Waiting', pl: 'Oczekuje' }, category: 'open', color: '#64748b', weight: 15 };

  it('creates a status with a snake_case code, a name per language, a category and a #rrggbb colour', () => {
    accepts(tasks.CreateTaskStatusBodySchema, status);
    accepts(tasks.CreateTaskStatusBodySchema, { ...status, isInitial: true });
    rejects(tasks.CreateTaskStatusBodySchema, { ...status, code: 'Waiting' });
    rejects(tasks.CreateTaskStatusBodySchema, { ...status, category: 'closed' });
    rejects(tasks.CreateTaskStatusBodySchema, { ...status, color: 'grey' });
    rejects(tasks.CreateTaskStatusBodySchema, { ...status, name: { en: 'Waiting' } });
  });

  it('updates every field but the code', () => {
    accepts(tasks.UpdateTaskStatusBodySchema, { color: '#000000' });
    rejects(tasks.UpdateTaskStatusBodySchema, { code: 'renamed' });
    rejects(tasks.UpdateTaskStatusBodySchema, {});
  });

  it('removes a status with an optional replacement code', () => {
    accepts(tasks.DeleteTaskStatusQuerySchema, {});
    accepts(tasks.DeleteTaskStatusQuerySchema, { replacement: 'done' });
    rejects(tasks.DeleteTaskStatusQuerySchema, { replacement: 'Done!' });
  });

  it('changes transitions as a delta of edges between two different statuses', () => {
    accepts(tasks.SetTaskTransitionsBodySchema, { add: [{ from: 'todo', to: 'waiting' }] });
    accepts(tasks.SetTaskTransitionsBodySchema, { remove: [{ from: 'done', to: 'todo' }] });
    rejects(tasks.SetTaskTransitionsBodySchema, { add: [{ from: 'todo', to: 'todo' }] });
    rejects(tasks.SetTaskTransitionsBodySchema, {});
  });

  it('creates a priority like a status, without a category', () => {
    accepts(tasks.CreateTaskPriorityBodySchema, { code: 'blocker', name: { en: 'Blocker', pl: 'Bloker' }, color: '#dc2626', weight: 5 });
    rejects(tasks.CreateTaskPriorityBodySchema, { code: 'blocker', name: { en: 'Blocker', pl: 'Bloker' }, color: 'red', weight: 5 });
    accepts(tasks.UpdateTaskPriorityBodySchema, { weight: 1 });
    rejects(tasks.UpdateTaskPriorityBodySchema, { code: 'x' });
  });

  it('removes a priority with a replacement code or none', () => {
    accepts(tasks.DeleteTaskPriorityQuerySchema, { replacement: 'none' });
    accepts(tasks.DeleteTaskPriorityQuerySchema, { replacement: 'normal' });
    rejects(tasks.DeleteTaskPriorityQuerySchema, { replacement: 'NONE' });
  });

  it('a tag has a name of 1–64 characters and an optional #rrggbb colour', () => {
    accepts(tasks.CreateTaskTagBodySchema, { name: 'Showroom' });
    accepts(tasks.CreateTaskTagBodySchema, { name: 'x'.repeat(64), color: '#22c55e' });
    rejects(tasks.CreateTaskTagBodySchema, { name: 'x'.repeat(65) });
    rejects(tasks.CreateTaskTagBodySchema, { name: '  ' });
    rejects(tasks.CreateTaskTagBodySchema, { name: 'x', color: 'green' });
    accepts(tasks.UpdateTaskTagBodySchema, { color: '#000000' });
    rejects(tasks.UpdateTaskTagBodySchema, {});
  });

  it('board card fields are at most 6 distinct built-in or custom references', () => {
    expect([...tasks.TASK_BOARD_DEFAULT_CARD_FIELDS]).toEqual([
      'builtin:number',
      'builtin:assignees',
      'builtin:due',
      'builtin:priority',
      'builtin:tags',
    ]);
    accepts(tasks.SetTaskBoardCardFieldsBodySchema, { fields: ['builtin:number', 'custom:region'] });
    rejects(tasks.SetTaskBoardCardFieldsBodySchema, { fields: ['number'] });
    rejects(tasks.SetTaskBoardCardFieldsBodySchema, { fields: ['builtin:number', 'builtin:number'] });
    rejects(tasks.SetTaskBoardCardFieldsBodySchema, {
      fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => `custom:${k}`),
    });
  });

  it('the time zone is a non-empty name', () => {
    accepts(tasks.SetTaskTimeZoneBodySchema, { timeZone: 'Europe/Warsaw' });
    rejects(tasks.SetTaskTimeZoneBodySchema, { timeZone: '' });
  });
});

describe('§5 per-admin', () => {
  it('the digest hour is 0–23', () => {
    accepts(tasks.SetTaskDigestBodySchema, { hour: 0 });
    accepts(tasks.SetTaskDigestBodySchema, { hour: 23 });
    rejects(tasks.SetTaskDigestBodySchema, { hour: 24 });
    rejects(tasks.SetTaskDigestBodySchema, { hour: 7.5 });
  });
});

describe('the write port — NewContextTask', () => {
  it('takes assignees and a source key of at most 100 characters', () => {
    accepts(tasks.NewContextTaskSchema, { title: 'Install', assigneeIds: [UUID_A], sourceKey: 'x'.repeat(100) });
    rejects(tasks.NewContextTaskSchema, { title: 'Install', sourceKey: 'x'.repeat(101) });
    rejects(tasks.NewContextTaskSchema, { title: 'Install', sourceKey: '' });
    rejects(tasks.NewContextTaskSchema, { title: 'Install', assignedAdminUserId: UUID_A });
  });
});

describe('responses', () => {
  const summary = {
    id: UUID_A,
    number: 'TSK-000001',
    title: 'Measure',
    status: { code: 'todo', name: 'To do', color: '#64748b', category: 'open' },
    closed: false,
    assignees: [{ id: UUID_B, name: 'Anna', active: true }],
    dueOn: '2026-11-03',
    dueAt: null,
    overdue: false,
    priority: { code: 'high', name: 'High', color: '#f97316' },
    tags: [{ id: UUID_C, name: 'Showroom', color: '#64748b' }],
    context: {
      type: 'project',
      available: true,
      label: 'PRJ-000001 Showroom',
      href: `/projects/${UUID_C}`,
      groupLabel: 'Design',
    },
    parent: null,
    subtasks: { closed: 1, total: 3 },
    draft: false,
    private: false,
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
  };

  it('a summary carries the status by code, name, colour and category, and a list of assignees', () => {
    accepts(tasks.TaskSummarySchema, summary);
    accepts(tasks.TaskSummarySchema, { ...summary, assignees: [], priority: null, context: null });
    rejects(tasks.TaskSummarySchema, { ...summary, status: 'todo' });
    rejects(tasks.TaskSummarySchema, { ...summary, assignee: null, assignees: undefined });
  });

  it('a board column is a status, a count, the first cards and whether there are more', () => {
    accepts(tasks.TaskBoardSchema, {
      columns: [{ status: summary.status, count: 1, items: [summary], hasMore: false }],
    });
    rejects(tasks.TaskBoardSchema, { columns: [{ status: 'todo', items: [] }] });
  });

  it('the list page is items and a next cursor', () => {
    accepts(tasks.TaskListResponseSchema, { items: [], nextCursor: null });
    rejects(tasks.TaskListResponseSchema, { items: [] });
  });
});

describe('ports, events and error codes', () => {
  it('names the four events, assignees_changed replacing assigned', () => {
    expect(tasks.TASKS_EVENTS).toEqual({
      CREATED: 'tasks.task.created.v1',
      STATUS_CHANGED: 'tasks.task.status_changed.v1',
      ASSIGNEES_CHANGED: 'tasks.task.assignees_changed.v1',
      DELETED: 'tasks.task.deleted.v1',
    });
  });

  it('names the error codes of 163 and of research R-20', () => {
    for (const code of [
      'TASK_NOT_FOUND',
      'TASK_CONTEXT_INVALID',
      'TASK_ASSIGNEE_INVALID',
      'TASK_STATUS_UNKNOWN',
      'TASK_TRANSITION_FORBIDDEN',
      'TASK_TRANSITION_CONFLICT',
      'TASK_WORKFLOW_INVALID',
      'TASK_STATUS_IN_USE_TOO_MANY',
      'TASK_PRIORITY_UNKNOWN',
      'TASK_TAG_NAME_TAKEN',
      'TASK_TAG_UNKNOWN',
      'TASK_PRIVATE_ASSIGNEE',
      'TASK_PRIVATE_READ_ONLY',
      'TASK_ALREADY_PUBLISHED',
      'TASK_PARENT_CYCLE',
      'TASK_HIERARCHY_TOO_DEEP',
      'TASK_LINK_INVALID',
      'TASK_ATTACHMENT_REFUSED',
      'TASK_REMINDER_INVALID',
      'TASK_VIEW_NAME_TAKEN',
    ]) {
      expect(tasks.TASKS_ERROR_CODES).toContain(code);
    }
  });
});
