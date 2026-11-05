import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRecordReferenceToken,
  RecordHistoryPageSchema,
  TaskCommentListResponseSchema,
  TaskCommentResponseSchema,
  TaskDetailResponseSchema,
  TASK_COMMENT_MAX,
  type TaskComment,
  type TaskDetail,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow, seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * Comments on a Task (`specs/165-task-management/` User Story 4, FR-025,
 * FR-026, FR-006, research R-6; quickstart US4 row).
 *
 * A comment is written by anybody who may see the Task and is its author's
 * alone: only they edit or delete it, whatever else somebody holds. A deleted
 * comment stays in the thread, empty and marked. Every write is in the Task's
 * history. The body's references resolve per reader like the description's
 * and are kept in `task_references` as the comment's own rows. A new comment
 * tells every assignee and the Creator but its author, once — and somebody it
 * newly mentions gets the mention instead, never both.
 */
describe('tasks — comments with references (US4)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** An assignee who writes comments. */
  let alice: Person;
  /** Another assignee. */
  let bob: Person;
  /** Reads Tasks, assigned to nothing, holds no `tasks:see_private`. */
  let carol: Person;
  /** Holds no `tasks:read`. */
  let outsider: Person;
  let opportunity: { id: string; number: string };
  let project: { id: string; number: string };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const createdTasks: string[] = [];
  const createdProjects: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, cookies = admin) =>
    h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  async function createTask(body: Record<string, unknown>, cookies = admin): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    createdTasks.push(data.id);
    return data;
  }

  async function post(taskId: string, body: string, cookies: { b2b_session: string }): Promise<TaskComment> {
    const response = await call('POST', `/${taskId}/comments`, { body }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return TaskCommentResponseSchema.parse(response.json()).data;
  }

  async function thread(taskId: string, cookies = admin): Promise<TaskComment[]> {
    const response = await call('GET', `/${taskId}/comments`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskCommentListResponseSchema.parse(response.json()).data;
  }

  const bells = async (taskId: string, kind: string) =>
    (
      await h
        .em()
        .find(AdminNotification, { subjectId: taskId, kind }, { filters: false, orderBy: { createdAt: 'asc' } })
    ).map((entry) => entry.targetAdminUserId);

  const storedFor = async (taskId: string) =>
    (
      (await h
        .em()
        .getConnection()
        .execute(
          `select "source_kind", "source_id", "target_type", "target_id" from "task_references" where "task_id" = ?`,
          [taskId],
        )) as Array<{ source_kind: string; source_id: string | null; target_type: string; target_id: string }>
    )
      .map((row) => `${row.source_kind}:${row.source_id ?? '-'}:${row.target_type}:${row.target_id}`)
      .sort();

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    const writer = ['tasks:read', 'tasks:write', 'crm:read', 'projects:read'];
    alice = await seedCrmAdmin(h.em(), 'comments-alice', writer);
    bob = await seedCrmAdmin(h.em(), 'comments-bob', writer);
    carol = await seedCrmAdmin(h.em(), 'comments-carol', ['tasks:read']);
    outsider = await seedCrmAdmin(h.em(), 'comments-outsider', ['orders:read']);
    opportunity = await createCrmOpportunity(h, { title: 'Commented deal', organizationId: TEST_ORGANIZATION_ID });
    const projectResponse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/projects',
      cookies: admin,
      payload: {
        title: 'Commented project',
        organizationIds: [],
        stages: [{ name: 'Only', color: '#3b82f6', plannedDurationDays: 1 }],
      },
    });
    expect(projectResponse.statusCode, projectResponse.body).toBe(201);
    project = (projectResponse.json() as { data: { id: string; number: string } }).data;
    createdProjects.push(project.id);
  });

  afterAll(async () => {
    for (const person of [alice, bob, carol, outsider]) person?.undo();
    const connection = h.em().getConnection();
    if (createdTasks.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${createdTasks.join(',')}}`]);
    }
    if (createdProjects.length > 0) {
      await connection.execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${createdProjects.join(',')}}`]);
    }
    if (opportunity) await connection.execute(`delete from "crm_opportunities" where "id" = ?`, [opportunity.id]);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('lists a comment in time order with its author; only the author edits or deletes it', async () => {
    const task = await createTask({ title: 'Discussed', assigneeIds: [alice.adminUserId, bob.adminUserId] });
    const first = await post(task.id, 'First **thought**', alice.cookies);
    const second = await post(task.id, 'A reply', bob.cookies);
    expect(first).toMatchObject({ body: 'First **thought**', editedAt: null, deletedAt: null, references: [] });
    expect(first.author?.id).toBe(alice.adminUserId);
    expect((await thread(task.id)).map((comment) => comment.id)).toEqual([first.id, second.id]);
    expect((await call('GET', `/${task.id}`)).json().data.commentsCount).toBe(2);

    // Nobody else — not a colleague, not the platform administrator — changes it.
    for (const cookies of [bob.cookies, admin]) {
      const edit = await call('PATCH', `/${task.id}/comments/${first.id}`, { body: 'Hijacked' }, cookies);
      expect(edit.statusCode, edit.body).toBe(403);
      const removal = await call('DELETE', `/${task.id}/comments/${first.id}`, undefined, cookies);
      expect(removal.statusCode, removal.body).toBe(403);
    }

    const edited = await call('PATCH', `/${task.id}/comments/${first.id}`, { body: 'First thought, revised' }, alice.cookies);
    expect(edited.statusCode, edited.body).toBe(200);
    const revised = TaskCommentResponseSchema.parse(edited.json()).data;
    expect(revised.body).toBe('First thought, revised');
    expect(revised.editedAt).not.toBeNull();

    const removed = await call('DELETE', `/${task.id}/comments/${first.id}`, undefined, alice.cookies);
    expect(removed.statusCode, removed.body).toBe(204);
    // A soft delete: still in the thread, in its place, empty and marked.
    const after = await thread(task.id);
    expect(after.map((comment) => comment.id)).toEqual([first.id, second.id]);
    expect(after[0]).toMatchObject({ id: first.id, body: '', references: [] });
    expect(after[0]!.deletedAt).not.toBeNull();
    expect((await call('GET', `/${task.id}`)).json().data.commentsCount).toBe(1);
    // A deleted comment is changed no more, by anybody.
    const again = await call('PATCH', `/${task.id}/comments/${first.id}`, { body: 'Back' }, alice.cookies);
    expect(again.statusCode, again.body).toBe(404);
  });

  it('keeps every comment write in the Task history, without the text', async () => {
    const task = await createTask({ title: 'Audited thread' });
    const comment = await post(task.id, 'Secret plan', alice.cookies);
    expect(
      (await call('PATCH', `/${task.id}/comments/${comment.id}`, { body: 'Secret plan B' }, alice.cookies)).statusCode,
    ).toBe(200);
    expect((await call('DELETE', `/${task.id}/comments/${comment.id}`, undefined, alice.cookies)).statusCode).toBe(204);

    const response = await call('GET', `/${task.id}/history?limit=50`);
    expect(response.statusCode, response.body).toBe(200);
    const page = RecordHistoryPageSchema.parse(response.json());
    const comments = page.data.filter((entry) => entry.action.startsWith('tasks.comment.'));
    expect(comments.map((entry) => entry.action)).toEqual([
      'tasks.comment.delete',
      'tasks.comment.update',
      'tasks.comment.add',
    ]);
    expect(comments.every((entry) => entry.actor.id === alice.adminUserId)).toBe(true);
    expect(response.body).not.toContain('Secret plan');
  });

  it('resolves references to an Opportunity and a Project, and keeps them as the comment\'s own rows', async () => {
    const task = await createTask({ title: 'Linked talk' });
    const body =
      `See ${formatRecordReferenceToken('opportunity', opportunity.id)} ` +
      `and ${formatRecordReferenceToken('project', project.id)}`;
    // Written by an administrator who may see both records: a Project is its Members' (and see-all holders').
    const comment = await post(task.id, body, admin);
    expect(comment.references).toEqual([
      {
        type: 'opportunity',
        id: opportunity.id,
        available: true,
        label: opportunity.number,
        url: `/crm/opportunities/${opportunity.id}`,
      },
      { type: 'project', id: project.id, available: true, label: project.number, url: `/projects/${project.id}` },
    ]);
    expect((await thread(task.id))[0]!.references.map((reference) => reference.available)).toEqual([true, true]);
    expect(await storedFor(task.id)).toEqual(
      [
        `comment:${comment.id}:opportunity:${opportunity.id}`,
        `comment:${comment.id}:project:${project.id}`,
      ].sort(),
    );

    // A reader without `crm:read` and `projects:read` sees neither.
    const forCarol = await thread(task.id, carol.cookies);
    expect(forCarol[0]!.references.map((reference) => [reference.type, reference.available, reference.label])).toEqual([
      ['opportunity', false, null],
      ['project', false, null],
    ]);

    // Refreshed by the edit, gone with the delete.
    const edited = await call(
      'PATCH',
      `/${task.id}/comments/${comment.id}`,
      { body: `Only ${formatRecordReferenceToken('project', project.id)}` },
      admin,
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await storedFor(task.id)).toEqual([`comment:${comment.id}:project:${project.id}`]);
    expect((await call('DELETE', `/${task.id}/comments/${comment.id}`, undefined, admin)).statusCode).toBe(204);
    expect(await storedFor(task.id)).toEqual([]);
  });

  it('tells the assignees and the Creator about a new comment, never its author', async () => {
    const task = await createTask({ title: 'Told about', assigneeIds: [alice.adminUserId, bob.adminUserId] });
    await post(task.id, 'Started on it', alice.cookies);
    expect((await bells(task.id, 'tasks.task.comment')).sort()).toEqual([bob.adminUserId, TEST_ADMIN_ID].sort());
    const [entry] = await h
      .em()
      .find(AdminNotification, { subjectId: task.id, kind: 'tasks.task.comment' }, { filters: false });
    expect(entry!.title).toBe(`New comment on task ${task.number}`);
    expect(entry!.linkPath).toBe(`/tasks/${task.id}`);
    expect(entry!.title).not.toContain('Started on it');

    // An edit tells nobody about a comment again.
    const [comment] = await thread(task.id);
    await call('PATCH', `/${task.id}/comments/${comment!.id}`, { body: 'Started on it today' }, alice.cookies);
    expect(await bells(task.id, 'tasks.task.comment')).toHaveLength(2);
  });

  it('gives a mentioned assignee the mention only, once', async () => {
    const task = await createTask({ title: 'Mention wins', assigneeIds: [alice.adminUserId, bob.adminUserId] });
    await post(task.id, `Over to you ${formatRecordReferenceToken('admin_user', bob.adminUserId)}`, alice.cookies);
    expect(await bells(task.id, 'tasks.task.mention')).toEqual([bob.adminUserId]);
    expect(await bells(task.id, 'tasks.task.comment')).toEqual([TEST_ADMIN_ID]);

    // Mentioned again in a later comment: told again, as that comment is new; still never both.
    await post(
      task.id,
      `${formatRecordReferenceToken('admin_user', bob.adminUserId)} ${formatRecordReferenceToken('admin_user', carol.adminUserId)}`,
      alice.cookies,
    );
    expect((await bells(task.id, 'tasks.task.mention')).sort()).toEqual(
      [bob.adminUserId, bob.adminUserId, carol.adminUserId].sort(),
    );
    expect(await bells(task.id, 'tasks.task.comment')).toEqual([TEST_ADMIN_ID, TEST_ADMIN_ID]);
  });

  it('refuses a comment from somebody who may not see the Task (404), and from somebody who may not read Tasks', async () => {
    const task = await createTask({ title: 'Alice alone' }, alice.cookies);
    await h.em().getConnection().execute(`update "tasks" set "is_private" = true where "id" = ?`, [task.id]);

    const hidden = await call('POST', `/${task.id}/comments`, { body: 'Hello?' }, carol.cookies);
    expect(hidden.statusCode, hidden.body).toBe(404);
    expect(hidden.json().error.code).toBe('TASK_NOT_FOUND');
    expect((await call('GET', `/${task.id}/comments`, undefined, carol.cookies)).statusCode).toBe(404);

    // A holder of `tasks:see_private` reads someone else's private Task, and only reads it.
    const readOnly = await call('POST', `/${task.id}/comments`, { body: 'Hello?' });
    expect(readOnly.statusCode, readOnly.body).toBe(403);
    expect(readOnly.json().error.code).toBe('TASK_PRIVATE_READ_ONLY');

    const open = await createTask({ title: 'Open to readers' });
    expect((await call('POST', `/${open.id}/comments`, { body: 'Hi' }, outsider.cookies)).statusCode).toBe(403);
    // A reader may comment.
    expect((await call('POST', `/${open.id}/comments`, { body: 'Hi' }, carol.cookies)).statusCode).toBe(201);
    expect(await thread(task.id, alice.cookies)).toEqual([]);
  });

  it('refuses an empty or too long body, and a comment of another Task', async () => {
    const task = await createTask({ title: 'Validated' });
    const other = await createTask({ title: 'Elsewhere' });
    expect((await call('POST', `/${task.id}/comments`, { body: '   ' }, alice.cookies)).statusCode).toBe(400);
    expect(
      (await call('POST', `/${task.id}/comments`, { body: 'x'.repeat(TASK_COMMENT_MAX + 1) }, alice.cookies)).statusCode,
    ).toBe(400);
    const comment = await post(other.id, 'Here', alice.cookies);
    expect(
      (await call('PATCH', `/${task.id}/comments/${comment.id}`, { body: 'Moved' }, alice.cookies)).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/${task.id}/comments/not-a-uuid`, undefined, alice.cookies)).statusCode).toBe(404);
  });
});
