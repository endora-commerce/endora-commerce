import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  TASKS_EVENTS,
  TaskDetailResponseSchema,
  TaskPriorityListResponseSchema,
  TaskTagListResponseSchema,
  TaskTagResponseSchema,
  type TaskDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * User Story 1 — a Task as a full work item (`specs/165-task-management/`
 * spec US1 scenarios 3–6, FR-001, FR-002, FR-007, FR-009, FR-010, FR-011;
 * `contracts/admin-api.md` §1, §4).
 *
 * Several assignees, each told once and never the actor; an assignee who may
 * not read Tasks refused; a due moment whose date is counted in
 * `tasks.time_zone`, overdue at the moment or after the day; a start date; a
 * priority and tags from the operator's lists, an unknown one refused;
 * custom-field values validated against the `task` host; and every change in
 * the history, each kind of change its own audited Command.
 */
describe('tasks — the fields of a Task (US1)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let first: Person;
  let second: Person;
  /** An active administrator without `tasks:read`. */
  let outsider: Person;
  /** Writes Tasks, configures nothing. */
  let writer: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];
  const tags: string[] = [];
  const definitions: string[] = [];

  function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, cookies = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function create(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  async function patch(id: string, body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('PATCH', `/${id}`, body, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  async function tag(name: string, color?: string): Promise<string> {
    const response = await call('POST', '/tags', { name, ...(color ? { color } : {}) });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskTagResponseSchema.parse(response.json());
    tags.push(data.id);
    return data.id;
  }

  const bellAbout = (taskId: string) =>
    h.em().find(AdminNotification, { subjectId: taskId }, { filters: false, orderBy: { createdAt: 'asc' } });

  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => [...rows].reverse());

  beforeAll(async () => {
    h = await setupBackendServer();
    first = await seedCrmAdmin(h.em(), 'fields-first', ['tasks:read', 'tasks:write']);
    second = await seedCrmAdmin(h.em(), 'fields-second', ['tasks:read']);
    outsider = await seedCrmAdmin(h.em(), 'fields-outsider', ['orders:read']);
    writer = await seedCrmAdmin(h.em(), 'fields-writer', ['tasks:read', 'tasks:write']);
  });

  afterAll(async () => {
    for (const person of [first, second, outsider, writer]) person?.undo();
    const connection = h.em().getConnection();
    if (created.length > 0) await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    if (tags.length > 0) await connection.execute(`delete from "task_tags" where "id" = any(?::uuid[])`, [`{${tags.join(',')}}`]);
    for (const id of definitions) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/custom-fields/definitions/${id}`, cookies: admin });
    }
    await teardownBackendServer(h);
  });

  /**
   * Issue #470 (D-288; owner ruling O-1: a title is a value). The global audit
   * log names what changed; the Task's history serves the values from the
   * Task's own store, and only to a reader who may see the Task.
   */
  describe('audit state names, the history shows values (#470)', () => {
    it('keeps the title out of the global audit log and serves it in the Task’s history', async () => {
      const task = await create({ title: 'S470-TASK-TITLE' });
      await patch(task.id, { title: 'S470-TASK-TITLE-NEW' });

      const global = await h.app.inject({ method: 'GET', url: `/api/v1/admin/audit-log?filter[objectId]=${task.id}`, cookies: admin });
      expect(global.statusCode, global.body).toBe(200);
      const rows = (global.json() as { data: Array<{ action: string; stateBefore: unknown; stateAfter: unknown }> }).data;
      expect(rows.map((row) => row.action).sort()).toEqual(['tasks.task.create', 'tasks.task.update']);
      expect(JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]))).not.toContain('S470');
      expect(rows.find((row) => row.action === 'tasks.task.update')?.stateAfter).toMatchObject({ changedFields: ['title'] });

      const history = await call('GET', `/${task.id}/history?limit=50`);
      expect(history.statusCode, history.body).toBe(200);
      const [update] = (history.json() as { data: Array<{ action: string; before: unknown; after: unknown }> }).data;
      expect(update).toMatchObject({
        action: 'tasks.task.update',
        before: { title: 'S470-TASK-TITLE' },
        after: { title: 'S470-TASK-TITLE-NEW' },
      });
      expect(update?.after).not.toHaveProperty('valueChangeId');
    });

    it('answers a reader who may not see the Task 404, as for a missing one', async () => {
      const task = await create({ title: 'S470-PRIVATE', private: true }, first.cookies);
      const hidden = await call('GET', `/${task.id}/history`, undefined, second.cookies);
      const missing = await call('GET', `/${randomUUID()}/history`, undefined, second.cookies);
      expect(hidden.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(hidden.json().error.code).toBe(missing.json().error.code);
      expect(hidden.body).not.toContain('S470');
    });
  });

  describe('assignees (FR-001)', () => {
    it('two assignees added are each told once, by number; the actor among them is never told', async () => {
      const task = await create({ title: 'Install the racks', assigneeIds: [TEST_ADMIN_ID] });
      const updated = await patch(task.id, { addAssigneeIds: [first.adminUserId, second.adminUserId] });
      expect(updated.assignees.map((a) => a.id)).toEqual([TEST_ADMIN_ID, first.adminUserId, second.adminUserId]);
      const bell = await bellAbout(task.id);
      expect(bell.map((n) => n.targetAdminUserId).sort()).toEqual([first.adminUserId, second.adminUserId].sort());
      for (const entry of bell) expect(entry.title).toContain(task.number);
      // Saving them again tells nobody again; removing one tells nobody.
      await patch(task.id, { assigneeIds: [TEST_ADMIN_ID, first.adminUserId, second.adminUserId] });
      await patch(task.id, { removeAssigneeIds: [second.adminUserId] });
      expect(await bellAbout(task.id)).toHaveLength(2);
      // Each assignee has it in My Tasks.
      const mine = await call('GET', '/mine', undefined, first.cookies);
      expect((mine.json() as { data: Array<{ id: string }> }).data.map((t) => t.id)).toContain(task.id);
    });

    it('refuses an assignee who may not read Tasks — 422 TASK_ASSIGNEE_INVALID, nothing written', async () => {
      const refused = await call('POST', '', { title: 'Not for outsiders', assigneeIds: [outsider.adminUserId] });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe(ERROR_CODES.TASK_ASSIGNEE_INVALID);
      const task = await create({ title: 'Later' });
      const later = await call('PATCH', `/${task.id}`, { addAssigneeIds: [outsider.adminUserId] });
      expect(later.statusCode, later.body).toBe(422);
      expect(later.json().error.code).toBe(ERROR_CODES.TASK_ASSIGNEE_INVALID);
      expect(await bellAbout(task.id)).toEqual([]);
    });

    it('refuses more than 20 assignees', async () => {
      const many = Array.from({ length: 21 }, () => randomUUID());
      const refused = await call('POST', '', { title: 'Crowded', assigneeIds: many });
      expect(refused.statusCode, refused.body).toBe(400);
    });
  });

  describe('due moment and start date (FR-002)', () => {
    it('a due time sets the due date in tasks.time_zone, and the date only is cleared by the time', async () => {
      // 23:30 UTC on 1 November is 00:30 on 2 November in Warsaw (CET).
      const task = await create({ title: 'Late call', dueAt: '2026-11-01T23:30:00.000Z', startOn: '2026-10-30' });
      expect(task).toMatchObject({ dueAt: '2026-11-01T23:30:00.000Z', dueOn: '2026-11-02', startOn: '2026-10-30' });
      const dated = await patch(task.id, { dueOn: '2026-12-24', dueAt: null });
      expect(dated).toMatchObject({ dueAt: null, dueOn: '2026-12-24' });
      const cleared = await patch(task.id, { dueOn: null, startOn: null });
      expect(cleared).toMatchObject({ dueAt: null, dueOn: null, startOn: null });
    });

    it('is overdue from the due time, and from the day after a date-only due date', async () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
      expect((await create({ title: 'Missed the hour', dueAt: hourAgo })).overdue).toBe(true);
      expect((await create({ title: 'Not yet', dueAt: inAnHour })).overdue).toBe(false);
      expect((await create({ title: 'Due today', dueOn: today })).overdue).toBe(false);
      expect((await create({ title: 'Long gone', dueOn: '2001-01-01' })).overdue).toBe(true);
    });
  });

  describe('priority (FR-009)', () => {
    it('lists the operator’s priorities, sets one, clears it, and refuses an unknown code', async () => {
      const listed = await call('GET', '/priorities', undefined, second.cookies);
      expect(listed.statusCode, listed.body).toBe(200);
      const priorities = TaskPriorityListResponseSchema.parse(listed.json()).data;
      expect(priorities.map((p) => p.code)).toEqual(expect.arrayContaining(['urgent', 'high', 'normal', 'low']));

      const task = await create({ title: 'Prioritised', priorityCode: 'high' });
      expect(task.priority).toMatchObject({ code: 'high' });
      expect((await patch(task.id, { priorityCode: 'low' })).priority).toMatchObject({ code: 'low' });
      expect((await patch(task.id, { priorityCode: null })).priority).toBeNull();

      for (const refused of [
        await call('POST', '', { title: 'Unknown priority', priorityCode: 'whenever' }),
        await call('PATCH', `/${task.id}`, { priorityCode: 'whenever' }),
      ]) {
        expect(refused.statusCode, refused.body).toBe(422);
        expect(refused.json().error.code).toBe(ERROR_CODES.TASK_PRIORITY_UNKNOWN);
      }
    });
  });

  describe('tags (FR-010)', () => {
    it('sets and replaces the tags, refuses an unknown one, and lists them with their usage', async () => {
      const install = await tag(`Install ${randomUUID().slice(0, 6)}`, '#0ea5e9');
      const urgent = await tag(`Urgent ${randomUUID().slice(0, 6)}`);
      const task = await create({ title: 'Tagged', tagIds: [install] });
      expect(task.tags.map((t) => t.id)).toEqual([install]);
      expect(task.tags[0]).toMatchObject({ color: '#0ea5e9' });
      const replaced = await patch(task.id, { tagIds: [urgent, install] });
      expect(replaced.tags.map((t) => t.id).sort()).toEqual([install, urgent].sort());
      expect((await patch(task.id, { tagIds: [urgent] })).tags.map((t) => t.id)).toEqual([urgent]);

      const unknown = await call('PATCH', `/${task.id}`, { tagIds: [randomUUID()] });
      expect(unknown.statusCode, unknown.body).toBe(422);
      expect(unknown.json().error.code).toBe(ERROR_CODES.TASK_TAG_UNKNOWN);

      const listed = TaskTagListResponseSchema.parse((await call('GET', '/tags', undefined, second.cookies)).json()).data;
      expect(listed.find((t) => t.id === urgent)).toMatchObject({ usageCount: 1 });
      expect(listed.find((t) => t.id === install)).toMatchObject({ usageCount: 0 });
    });

    it('creating a tag needs tasks:configure', async () => {
      const refused = await call('POST', '/tags', { name: `Writer ${randomUUID().slice(0, 6)}` }, writer.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
    });
  });

  describe('custom fields (FR-007)', () => {
    it('validates the values against the task host’s definitions, and keeps valid ones', async () => {
      const key = `rooms_${randomUUID().slice(0, 6)}`;
      const defined = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/custom-fields/definitions',
        cookies: admin,
        payload: {
          entityType: 'task',
          key,
          label: {},
          labelDefault: 'Rooms',
          valueType: 'number',
          required: false,
          sortOrder: 0,
          config: {},
          options: [],
        },
      });
      expect(defined.statusCode, defined.body).toBe(201);
      definitions.push((defined.json() as { data: { id: string } }).data.id);

      const refused = await call('POST', '', { title: 'Bad value', customFieldValues: { [key]: 'many' } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);

      const task = await create({ title: 'Good value', customFieldValues: { [key]: 3 } });
      expect(task.customFieldValues).toMatchObject({ [key]: 3 });
      expect((await patch(task.id, { customFieldValues: { [key]: 4 } })).customFieldValues).toMatchObject({ [key]: 4 });
      const invalidLater = await call('PATCH', `/${task.id}`, { customFieldValues: { [key]: 'four' } });
      expect(invalidLater.statusCode, invalidLater.body).toBe(422);
      const changed = (await audit(task.id)).find((row) => row.action === 'tasks.task.custom_fields_change');
      // The entry names the key; the values are the Task's own store's (#470).
      expect(changed?.stateBefore ?? null).toBeNull();
      expect(changed?.stateAfter).toMatchObject({ changedCustomFields: [key], valueChangeId: expect.any(String) });
      const [stored] = (await h.orm.em
        .getConnection()
        .execute(`select "before", "after" from "task_value_changes" where "id" = ?`, [
          (changed!.stateAfter as { valueChangeId: string }).valueChangeId,
        ])) as Array<{ before: unknown; after: unknown }>;
      expect(stored).toEqual({ before: { customFieldValues: { [key]: 3 } }, after: { customFieldValues: { [key]: 4 } } });
    });
  });

  describe('history (FR-011)', () => {
    it('records each kind of change as its own audited Command, with what changed', async () => {
      const urgent = await tag(`History ${randomUUID().slice(0, 6)}`);
      const task = await create({ title: 'Audited' });
      const seen: string[] = [];
      const off = h.eventBus.on(TASKS_EVENTS.ASSIGNEES_CHANGED as never, () => {
        seen.push('assignees');
      });
      try {
        await patch(task.id, {
          dueAt: '2026-12-01T09:00:00.000Z',
          startOn: '2026-11-20',
          priorityCode: 'urgent',
          tagIds: [urgent],
          assigneeIds: [first.adminUserId],
        });
      } finally {
        off();
      }
      expect(seen).toEqual(['assignees']);
      const rows = await audit(task.id);
      expect(rows.map((row) => row.action)).toEqual([
        'tasks.task.create',
        'tasks.task.update',
        'tasks.task.priority_change',
        'tasks.task.tags_change',
        'tasks.task.assignees_change',
      ]);
      const byAction = new Map(rows.map((row) => [row.action, row]));
      expect(byAction.get('tasks.task.update')!.stateAfter).toMatchObject({
        dueAt: '2026-12-01T09:00:00.000Z',
        dueOn: '2026-12-01',
        startOn: '2026-11-20',
      });
      expect(byAction.get('tasks.task.priority_change')).toMatchObject({
        stateBefore: { priorityCode: null },
        stateAfter: { priorityCode: 'urgent' },
      });
      expect(byAction.get('tasks.task.tags_change')).toMatchObject({
        stateBefore: { tagIds: [] },
        stateAfter: { tagIds: [urgent] },
      });

      const history = await call('GET', `/${task.id}/history`, undefined, second.cookies);
      expect(history.statusCode, history.body).toBe(200);
      expect((history.json() as { data: Array<{ action: string }> }).data.map((e) => e.action)).toEqual(
        expect.arrayContaining(['tasks.task.priority_change', 'tasks.task.tags_change']),
      );
    });
  });
});
