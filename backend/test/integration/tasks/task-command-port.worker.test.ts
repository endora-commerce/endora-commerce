import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TASKS_EVENTS, TaskDetailResponseSchema, type TaskCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `specs/186-aggregate-ports/` T094 (issue #1829, US10 scenario 1) — a worker,
 * with no request behind it, writes Tasks through `taskCommandPort`.
 *
 * - A draft published by a worker acting for its Creator
 *   (`withSystemScopeActingFor`) tells its assignees as the admin path does,
 *   once, and announces the Task as created.
 * - A worker under the bare system scope moves and edits a Task as the
 *   `system` actor, recording the integration's `source` beside it.
 */
describe('taskCommandPort — from a worker (#1829)', () => {
  let h: BackendServerHandle;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const created: string[] = [];

  const port = () => h.container.resolve<TaskCommandPort>('taskCommandPort');
  const bells = (taskId: string) =>
    h
      .em()
      .fork()
      .find(AdminNotification, { subjectId: taskId, targetAdminUserId: colleague.adminUserId }, { filters: false });
  const entries = (taskId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'task', objectId: taskId }, { orderBy: { actedAt: 'asc' } });

  async function draft(): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/tasks',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { title: 'Queued for the worker', draft: true, assigneeIds: [colleague.adminUserId] },
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = TaskDetailResponseSchema.parse(response.json()).data.id;
    created.push(id);
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    colleague = await seedCrmAdmin(h.em(), 'task-worker-colleague', ['tasks:read', 'tasks:write']);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    colleague.undo();
    await teardownBackendServer(h);
  });

  it('publishes a draft for its Creator, and the assignee is told once', async () => {
    const id = await draft();
    expect(await bells(id)).toHaveLength(0);
    const announced: unknown[] = [];
    const off = h.eventBus.on(TASKS_EVENTS.CREATED as never, (payload: unknown) => {
      announced.push(payload);
    });
    try {
      const record = await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: publish queued drafts', () =>
        port().publish(id, { source: 'drafts.scheduler' }),
      );
      expect(record).toMatchObject({ id, draft: false, assigneeIds: [colleague.adminUserId] });
    } finally {
      off();
    }
    expect(await bells(id)).toHaveLength(1);
    expect(announced).toEqual([expect.objectContaining({ taskId: id, assigneeIds: [colleague.adminUserId] })]);
    const publish = (await entries(id)).at(-1)!;
    expect(publish).toMatchObject({ action: 'tasks.task.publish', actorAdminUserId: TEST_ADMIN_ID });
    expect(publish.stateAfter).toMatchObject({ source: 'drafts.scheduler' });
  });

  it('moves and edits a Task as the system actor, with the integration’s source', async () => {
    const id = await draft();
    await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: publish queued drafts', () => port().publish(id));
    const moved = await withSystemScope('test: nightly task sync', async () => {
      await port().setStatus(id, { to: 'in_progress' }, { source: 'nightly.sync' });
      return port().update(id, { dueOn: '2027-02-01' }, { source: 'nightly.sync' });
    });
    expect(moved).toMatchObject({ id, status: 'in_progress', dueOn: '2027-02-01' });
    const written = (await entries(id)).slice(-2);
    expect(written.map((e) => [e.action, e.actorAdminUserId ?? null])).toEqual([
      ['tasks.task.status_change', null],
      ['tasks.task.update', null],
    ]);
    for (const entry of written) expect(entry.stateAfter).toMatchObject({ source: 'nightly.sync' });
  });
});
