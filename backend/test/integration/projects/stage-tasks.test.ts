import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MaterializeStageTasksResponseSchema,
  ProjectStageResponseSchema,
  ProjectStageEntryListResponseSchema,
  TaskDetailResponseSchema,
  type ProjectDetail,
  type TaskCommandPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import {
  callProjects,
  callTasks,
  createProject,
  deleteProjects,
  deleteProjectTasks,
  dictionaryIds,
  getProject,
  moveProjectOk,
  plusDays,
  stageNamed,
  taskRowsOf,
  warsawToday,
  withTasksOff,
} from './helpers.js';

/**
 * User Story 2 — Stage Tasks (`specs/163-projects-and-tasks/research.md` R-7,
 * R-8; FR-017, FR-040).
 *
 * A Stage's Task definitions become Tasks when the Project enters the Stage —
 * due the Stage's start plus their offset, in the context `{ project,
 * projectId, stageId }`, assigned to the one Member holding their Role or else
 * left unassigned with the Role named in the Task's note. Once per Stage:
 * re-entering creates nothing, and a Stage entered while Tasks was off is
 * marked skipped for good. A failure of the Tasks module leaves the Stage
 * entered, says so, and can be retried once.
 */
describe('projects — Stage Tasks (US2)', () => {
  let h: BackendServerHandle;
  let roles: Record<string, string>;
  let installer: string;
  let surveyor: string;
  const people: Array<{ adminUserId: string; undo: () => void }> = [];
  const created: string[] = [];

  async function project(title: string): Promise<ProjectDetail> {
    const [ann, bob, cid] = people;
    const made = await createProject(h, {
      title,
      members: [
        { adminUserId: ann!.adminUserId, roleIds: [installer] },
        { adminUserId: bob!.adminUserId, roleIds: [surveyor] },
        { adminUserId: cid!.adminUserId, roleIds: [surveyor] },
        { adminUserId: TEST_ADMIN_ID, roleIds: [roles.project_manager!] },
      ],
    });
    created.push(made.id);
    return made;
  }

  function putStageTasks(projectId: string, stageId: string, tasks: unknown[]) {
    return callProjects(h, 'PUT', `/${projectId}/stages/${stageId}/tasks`, { payload: { tasks } });
  }

  const DEFINITIONS = () => [
    { title: 'Fit the racks', description: 'Bay 1 to 4', responsibleRoleId: installer, dueOffsetDays: 3 },
    { title: 'Measure again', responsibleRoleId: surveyor, dueOffsetDays: 0 },
    { title: 'Tell the client', dueOffsetDays: 1 },
  ];

  async function insertRole(code: string, name: string): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "project_roles" ("id", "code", "name", "default_name", "position") values (?, ?, ?, ?, 900)`,
        [id, `${code}_${id.slice(0, 8)}`, JSON.stringify({ en: name, pl: `${name} (pl)` }), name],
      );
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    roles = await dictionaryIds(h, 'project_roles');
    installer = await insertRole('installer', 'Installer');
    surveyor = await insertRole('surveyor', 'Surveyor');
    for (const label of ['st-ann', 'st-bob', 'st-cid']) {
      people.push(await seedCrmAdmin(h.em(), label, ['projects:read', 'tasks:read']));
    }
  });

  afterAll(async () => {
    for (const person of people) person.undo();
    await deleteProjectTasks(h, created);
    await deleteProjects(h, created);
    await h
      .em()
      .getConnection()
      .execute(`delete from "project_roles" where "id" = any(?::uuid[])`, [`{${installer},${surveyor}}`]);
    await teardownBackendServer(h);
  });

  it('sets a Stage’s Task definitions, replaced whole, in order; more than 100 is refused', async () => {
    const p = await project('Definitions');
    const build = stageNamed(p, 'Build');
    const response = await putStageTasks(p.id, build, DEFINITIONS());
    expect(response.statusCode, response.body).toBe(200);
    const stage = ProjectStageResponseSchema.parse(response.json()).data;
    expect(stage.stageTasks.map((t) => [t.title, t.position, t.dueOffsetDays])).toEqual([
      ['Fit the racks', 1, 3],
      ['Measure again', 2, 0],
      ['Tell the client', 3, 1],
    ]);
    expect((await getProject(h, p.id)).stages.find((s) => s.id === build)!.stageTasks).toHaveLength(3);

    const replaced = await putStageTasks(p.id, build, [{ title: 'Only this', dueOffsetDays: 0 }]);
    expect(ProjectStageResponseSchema.parse(replaced.json()).data.stageTasks.map((t) => t.title)).toEqual(['Only this']);

    const tooMany = Array.from({ length: 101 }, (_, i) => ({ title: `T${i}`, dueOffsetDays: 0 }));
    expect((await putStageTasks(p.id, build, tooMany)).statusCode).toBe(400);
    const unknownRole = await putStageTasks(p.id, build, [{ title: 'x', dueOffsetDays: 0, responsibleRoleId: randomUUID() }]);
    expect(unknownRole.statusCode, unknownRole.body).toBe(422);
    expect((await putStageTasks(p.id, randomUUID(), [])).statusCode).toBe(404);
    expect((await putStageTasks(randomUUID(), build, [])).statusCode).toBe(404);

    const audit = await h.auditLogService.query({ objectType: 'project', objectId: p.id, action: 'projects.project.stage_tasks_set' });
    expect(audit).toHaveLength(2);
  });

  it('creates the Stage Tasks on entry: dated from the Stage’s start, in its context, assigned by Role', async () => {
    const p = await project('Materialised');
    const build = stageNamed(p, 'Build');
    expect((await putStageTasks(p.id, build, DEFINITIONS())).statusCode).toBe(200);

    const moved = await moveProjectOk(h, p.id, build, p.version);
    expect(moved.createdTaskIds).toHaveLength(3);
    expect(moved.notes).toEqual([]);
    const stage = moved.project.stages.find((s) => s.id === build)!;
    expect(stage.tasksMaterializedAt).not.toBeNull();
    expect(stage.tasksSkippedAt).toBeNull();

    const start = warsawToday();
    const tasks = [];
    for (const id of moved.createdTaskIds) {
      const response = await callTasks(h, 'GET', `/${id}`);
      expect(response.statusCode, response.body).toBe(200);
      tasks.push(TaskDetailResponseSchema.parse(response.json()).data);
    }
    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
    // The one Installer is assigned; two Surveyors leave it unassigned, the Role named.
    expect(byTitle['Fit the racks']).toMatchObject({
      dueOn: plusDays(start, 3),
      description: 'Bay 1 to 4',
      assignees: [expect.objectContaining({ id: people[0]!.adminUserId })],
      contextNote: null,
      createdBy: { id: TEST_ADMIN_ID },
    });
    expect(byTitle['Measure again']).toMatchObject({
      dueOn: start,
      assignees: [],
      contextNote: 'Responsible role: Surveyor',
    });
    expect(byTitle['Tell the client']).toMatchObject({ dueOn: plusDays(start, 1), assignees: [], contextNote: null });
    // The note is stored as the Role, not as English text, and read in the reader's language (163 T077).
    const [stored] = (await h
      .em()
      .getConnection()
      .execute(`select "context_note" from "tasks" where "id" = ?`, [byTitle['Measure again']!.id])) as Array<{
      context_note: string;
    }>;
    expect(stored!.context_note).not.toMatch(/Responsible role/);
    const bob = people[1] as unknown as { adminUserId: string; cookies: { b2b_session: string } };
    const setLanguage = (language: string | null) =>
      h.em().getConnection().execute(`update "admin_users" set "preferred_language" = ? where "id" = ?`, [language, bob.adminUserId]);
    await setLanguage('pl');
    const polish = await callTasks(h, 'GET', `/${byTitle['Measure again']!.id}`, { cookies: bob.cookies }).finally(() =>
      setLanguage(null),
    );
    expect(polish.statusCode, polish.body).toBe(200);
    expect(TaskDetailResponseSchema.parse(polish.json()).data.contextNote).toBe('Odpowiedzialna rola: Surveyor (pl)');
    for (const task of tasks) {
      expect(task.context).toMatchObject({
        type: 'project',
        id: p.id,
        groupId: build,
        available: true,
        label: `${p.number} Materialised`,
        href: `/projects/${p.id}`,
        groupLabel: 'Build',
      });
    }
    // One `tasks.task.create` audit row per Task, by the administrator who moved.
    for (const id of moved.createdTaskIds) {
      const audit = await h.auditLogService.query({ objectType: 'task', objectId: id });
      expect(audit.map((a) => [a.action, a.actorAdminUserId])).toEqual([['tasks.task.create', TEST_ADMIN_ID]]);
    }
  });

  it('re-entering a Stage creates nothing', async () => {
    const p = await project('Re-entry');
    const [design, build] = [stageNamed(p, 'Design'), stageNamed(p, 'Build')];
    expect((await putStageTasks(p.id, build, DEFINITIONS())).statusCode).toBe(200);
    expect(
      (
        await callProjects(h, 'PUT', `/${p.id}/moves`, {
          payload: { moves: [{ fromStageId: design, toStageId: build }, { fromStageId: build, toStageId: design }] },
        })
      ).statusCode,
    ).toBe(200);
    const first = await moveProjectOk(h, p.id, build, p.version);
    expect(first.createdTaskIds).toHaveLength(3);
    const back = await moveProjectOk(h, p.id, design, first.project.version);
    const again = await moveProjectOk(h, p.id, build, back.project.version);
    expect(again.createdTaskIds).toEqual([]);
    expect(await taskRowsOf(h, p.id)).toHaveLength(3);
  });

  it('a Stage entered while Tasks is off is skipped for good: noted, and nothing is created later', async () => {
    const p = await project('Skipped');
    const [design, build] = [stageNamed(p, 'Design'), stageNamed(p, 'Build')];
    expect((await putStageTasks(p.id, build, DEFINITIONS())).statusCode).toBe(200);
    await callProjects(h, 'PUT', `/${p.id}/moves`, {
      payload: { moves: [{ fromStageId: design, toStageId: build }, { fromStageId: build, toStageId: design }] },
    });

    const moved = await withTasksOff(() => moveProjectOk(h, p.id, build, p.version));
    expect(moved.createdTaskIds).toEqual([]);
    expect(moved.entry.notes).toEqual(['stage_tasks_skipped']);
    expect(moved.project.stages.find((s) => s.id === build)!.tasksSkippedAt).not.toBeNull();

    const back = await moveProjectOk(h, p.id, design, moved.project.version);
    const again = await moveProjectOk(h, p.id, build, back.project.version);
    expect(again.createdTaskIds).toEqual([]);
    expect(await taskRowsOf(h, p.id)).toEqual([]);
    // The definitions are kept (FR-040).
    expect(again.project.stages.find((s) => s.id === build)!.stageTasks).toHaveLength(3);
  });

  it('a failure creating them leaves the Stage entered and says so; the retry creates them once', async () => {
    const p = await project('Failed once');
    const build = stageNamed(p, 'Build');
    expect((await putStageTasks(p.id, build, DEFINITIONS())).statusCode).toBe(200);
    expect((await callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`)).statusCode).toBe(409);

    const port = h.container.resolve<TaskCommandPort>('taskCommandPort');
    const spy = vi.spyOn(port, 'createMany').mockRejectedValueOnce(new Error('tasks store unavailable'));
    let moved;
    try {
      moved = await moveProjectOk(h, p.id, build, p.version);
    } finally {
      spy.mockRestore();
    }
    expect(moved.project.currentStage?.id).toBe(build);
    expect(moved.createdTaskIds).toEqual([]);
    expect(moved.notes).toEqual(['tasks_materialize_failed']);
    expect(moved.entry.notes).toEqual(['tasks_materialize_failed']);
    expect(await taskRowsOf(h, p.id)).toEqual([]);
    const history = ProjectStageEntryListResponseSchema.parse(
      (await callProjects(h, 'GET', `/${p.id}/stage-history`)).json(),
    ).data;
    expect(history.find((e) => e.id === moved.entry.id)!.notes).toEqual(['tasks_materialize_failed']);
    // The Stage says so, which is what offers the retry on its screen (163 T079).
    expect(moved.project.stages.find((s) => s.id === build)!.tasksMaterializeFailed).toBe(true);
    expect(moved.project.stages.filter((s) => s.id !== build).map((s) => s.tasksMaterializeFailed)).toEqual([false, false]);

    const retry = await callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(MaterializeStageTasksResponseSchema.parse(retry.json()).data).toEqual({ created: 3 });
    expect(await taskRowsOf(h, p.id)).toHaveLength(3);
    expect((await getProject(h, p.id)).stages.find((s) => s.id === build)!.tasksMaterializeFailed).toBe(false);

    const twice = await callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`);
    expect(twice.statusCode, twice.body).toBe(409);
    expect((twice.json() as { error: { code: string } }).error.code).toBe('PROJECT_STAGE_TASKS_NOT_RETRYABLE');
    expect(await taskRowsOf(h, p.id)).toHaveLength(3);
  });

  it('a failure part way never duplicates: after 2 of 5, three retries — two of them at once — leave exactly 5 (#450)', async () => {
    const p = await project('Failed part way');
    const build = stageNamed(p, 'Build');
    const five = [
      ...DEFINITIONS(),
      { title: 'Order the parts', dueOffsetDays: 2 },
      { title: 'Book the crane', dueOffsetDays: 4 },
    ];
    const stage = ProjectStageResponseSchema.parse((await putStageTasks(p.id, build, five)).json()).data;
    const definitionIds = stage.stageTasks.map((t) => t.id);
    expect(definitionIds).toHaveLength(5);

    // The database fails on the n-th Task Command of a call: the Commands
    // before it have committed, one transaction each.
    const bus = h.container.resolve<{ run: (command: { action: string }) => Promise<unknown> }>('commandBus');
    const failOnTaskCreate = (n: number) => {
      const original = bus.run.bind(bus);
      let creates = 0;
      return vi.spyOn(bus, 'run').mockImplementation(async (command) => {
        if (command.action === 'tasks.task.create' && ++creates === n) throw new Error('tasks store unavailable');
        return original(command as never);
      });
    };

    let spy = failOnTaskCreate(3);
    let moved;
    try {
      moved = await moveProjectOk(h, p.id, build, p.version);
    } finally {
      spy.mockRestore();
    }
    expect(moved.notes).toEqual(['tasks_materialize_failed']);
    expect(await taskRowsOf(h, p.id)).toHaveLength(2);

    // The first retry fails too, on its second Task: one more is created.
    spy = failOnTaskCreate(2);
    let first;
    try {
      first = await callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`);
    } finally {
      spy.mockRestore();
    }
    expect(first.statusCode, first.body).not.toBe(200);
    expect(await taskRowsOf(h, p.id)).toHaveLength(3);
    expect((await getProject(h, p.id)).stages.find((s) => s.id === build)!.tasksMaterializeFailed).toBe(true);

    // Two retries at once: one creates what is missing, the other is refused.
    const [a, b] = await Promise.all([
      callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`),
      callProjects(h, 'POST', `/${p.id}/stages/${build}/materialize-tasks`),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);

    const rows = (await h
      .em()
      .getConnection()
      .execute(`select "title", "source_key" from "tasks" where "context_type" = 'project' and "context_id" = ?`, [
        p.id,
      ])) as Array<{ title: string; source_key: string | null }>;
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.source_key).sort()).toEqual([...definitionIds].sort());
    expect(rows.map((r) => r.title).sort()).toEqual(five.map((t) => t.title).sort());
    expect((await getProject(h, p.id)).stages.find((s) => s.id === build)!.tasksMaterializeFailed).toBe(false);
  });

  it('GET /projects/:id/tasks lists the Project’s Tasks by Stage; with Tasks off it says they are unavailable', async () => {
    const p = await project('Tab');
    const build = stageNamed(p, 'Build');
    expect((await putStageTasks(p.id, build, DEFINITIONS())).statusCode).toBe(200);
    await moveProjectOk(h, p.id, build, p.version);

    const response = await callProjects(h, 'GET', `/${p.id}/tasks`);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json() as { data: { tasksAvailable: boolean; stages: Array<{ stageId: string; tasks: Array<{ title: string; context: unknown }> }> } };
    expect(data.tasksAvailable).toBe(true);
    expect(data.stages.map((s) => s.stageId)).toEqual(p.stages.map((s) => s.id));
    expect(data.stages.find((s) => s.stageId === build)!.tasks.map((t) => t.title).sort()).toEqual(
      ['Fit the racks', 'Measure again', 'Tell the client'],
    );
    expect(data.stages.find((s) => s.stageId === build)!.tasks[0]!.context).toMatchObject({
      type: 'project',
      available: true,
      groupLabel: 'Build',
    });

    const off = await withTasksOff(() => callProjects(h, 'GET', `/${p.id}/tasks`));
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().data).toEqual({ tasksAvailable: false, stages: [] });
  });
});
