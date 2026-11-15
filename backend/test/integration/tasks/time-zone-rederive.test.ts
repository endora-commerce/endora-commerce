import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TaskDetailResponseSchema,
  TaskReminderListResponseSchema,
  TaskReminderResponseSchema,
  type TaskDetail,
  type TaskReminder,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import type { TaskTimeZoneRederiveService } from '../../../../packages/modules/tasks/src/backend/services/time-zone-rederive-service.js';
import {
  runTasksRemindersJob,
  type TasksRemindersJob,
} from '../../../../packages/modules/tasks/src/backend/workers/tasks-reminders-worker.js';

/**
 * Issue #505 — changing `tasks.time_zone` re-derives what was counted in the
 * old zone (`specs/165-task-management/` data-model §5, research R-17):
 *
 * - a relative reminder on a date-only Task counts from 09:00 of its due date
 *   in the **new** zone, and fires again there (its delivery rows go);
 * - `due_on` of a Task with a due time is that time's date in the new zone.
 *
 * Absolute reminders and relative reminders on a Task with a due time are
 * left alone: neither depends on the zone. The work is the `tasks-reminders`
 * tick's own pass, so it is driven as the consumer drives it. Every moment is
 * in 2032, and every row this file writes is a Task it created (or a row
 * cascading from one), deleted by id at the end; the zone is put back to the
 * default, and the pass run again, before it does.
 */
describe('tasks — a changed time zone re-derives due dates and reminders (#505)', () => {
  let h: BackendServerHandle;
  let ann: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];

  function call(method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown, cookies = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function setZone(timeZone: string): Promise<void> {
    const response = await call('PUT', '/settings/time-zone', { timeZone });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function create(body: Record<string, unknown>): Promise<TaskDetail> {
    const response = await call('POST', '', body, ann.cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  async function read(id: string): Promise<TaskDetail> {
    const response = await call('GET', `/${id}`, undefined, ann.cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  async function remind(taskId: string, body: Record<string, unknown>): Promise<TaskReminder> {
    const response = await call('POST', `/${taskId}/reminders`, body, ann.cookies);
    expect(response.statusCode, response.body).toBe(201);
    return TaskReminderResponseSchema.parse(response.json()).data;
  }

  async function remindersOf(taskId: string): Promise<TaskReminder[]> {
    const response = await call('GET', `/${taskId}/reminders`, undefined, ann.cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskReminderListResponseSchema.parse(response.json()).data;
  }

  const service = () => h.container.resolve('tasksTimeZoneRederiveService') as TaskTimeZoneRederiveService;
  /** One tick as the consumer runs it — presence, each probe outside any scope, then the passes. */
  const tick = (now: Date = new Date()): Promise<void> =>
    runWithoutTenantContext(() =>
      runTasksRemindersJob(h.container.resolve('tasksRemindersJob') as TasksRemindersJob, now),
    );
  const probe = () => runWithoutTenantContext(() => service().hasWork());

  const deliveries = async (reminderId: string) =>
    (await h
      .em()
      .getConnection()
      .execute(`select "admin_user_id" from "task_reminder_deliveries" where "reminder_id" = ?`, [reminderId])) as Array<{
      admin_user_id: string;
    }>;

  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => [...rows].reverse());

  beforeAll(async () => {
    h = await setupBackendServer();
    await setZone('Europe/Warsaw');
    ann = await seedCrmAdmin(h.em(), 'time-zone-ann', ['tasks:read', 'tasks:write']);
  });

  afterAll(async () => {
    // Back to the default, and what this file left drifted re-derived in it.
    await setZone('Europe/Warsaw');
    await enterSystemScope('test: tasks time zone', () => service().pass());
    ann?.undo();
    if (created.length > 0) {
      await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  it('moves a relative reminder on a date-only Task to 09:00 in the new zone, re-arms it, and leaves the zone-free ones', async () => {
    const dateOnly = await create({ title: 'Count the stock', dueOn: '2032-03-12' });
    const relative = await remind(dateOnly.id, { offsetMinutes: 60, recipientIds: [ann.adminUserId] });
    expect(relative.remindAt).toBe('2032-03-12T07:00:00.000Z');
    const absolute = await remind(dateOnly.id, { remindAt: '2032-03-11T10:00:00.000Z', recipientIds: [ann.adminUserId] });
    // A delivered relative reminder: a moved moment is a new reminder.
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "task_reminder_deliveries" ("reminder_id", "admin_user_id", "outcome") values (?, ?, 'delivered')`,
        [relative.id, ann.adminUserId],
      );
    const timed = await create({ title: 'Call the carrier', dueAt: '2032-03-12T10:00:00.000Z' });
    const timedRelative = await remind(timed.id, { offsetMinutes: 30, recipientIds: [ann.adminUserId] });

    await setZone('America/New_York');
    expect(await probe()).toBe(true);
    await tick();

    const after = new Map((await remindersOf(dateOnly.id)).map((reminder) => [reminder.id, reminder]));
    expect(after.get(relative.id)).toMatchObject({ mode: 'relative', offsetMinutes: 60, remindAt: '2032-03-12T13:00:00.000Z' });
    expect(after.get(absolute.id)?.remindAt).toBe('2032-03-11T10:00:00.000Z');
    expect(await deliveries(relative.id)).toEqual([]);
    expect((await remindersOf(timed.id))[0]?.remindAt).toBe(timedRelative.remindAt);
    expect((await read(dateOnly.id)).dueOn).toBe('2032-03-12');

    const entries = (await audit(dateOnly.id)).filter((entry) => entry.action === 'tasks.task.update');
    expect(entries.at(-1)).toMatchObject({
      stateBefore: { dueOn: '2032-03-12' },
      stateAfter: { dueOn: '2032-03-12', remindersMoved: 1, reason: 'time_zone_changed' },
    });
  });

  it("re-derives due_on of a Task with a due time as that time's date in the new zone", async () => {
    await setZone('Europe/Warsaw');
    await tick();
    // 00:30 in Warsaw on 13 March is still 12 March in New York.
    const timed = await create({ title: 'Ship the samples', dueAt: '2032-03-12T23:30:00.000Z' });
    expect(timed.dueOn).toBe('2032-03-13');

    await setZone('America/New_York');
    await tick();

    expect(await read(timed.id)).toMatchObject({ dueOn: '2032-03-12', dueAt: '2032-03-12T23:30:00.000Z' });
    const entries = (await audit(timed.id)).filter((entry) => entry.action === 'tasks.task.update');
    expect(entries.at(-1)).toMatchObject({
      stateBefore: { dueOn: '2032-03-13' },
      stateAfter: { dueOn: '2032-03-12', remindersMoved: 0, reason: 'time_zone_changed' },
    });
  });

  it('is a change of the setting by any path, and leaves nothing to do once it has run', async () => {
    const timed = await create({ title: 'Book the hall', dueAt: '2032-04-01T22:30:00.000Z' });
    // The generic settings write, not the Tasks screen's.
    const written = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/tasks.time_zone/value',
      cookies: admin,
      payload: { scope: 'all', value: 'Asia/Tokyo' },
    });
    expect(written.statusCode, written.body).toBeLessThan(400);
    expect(await probe()).toBe(true);
    await tick();

    expect((await read(timed.id)).dueOn).toBe('2032-04-02');
    expect(await probe()).toBe(false);
    const updates = async () => (await audit(timed.id)).filter((entry) => entry.action === 'tasks.task.update').length;
    const before = await updates();
    await tick();
    expect(await updates()).toBe(before);
  });
});
