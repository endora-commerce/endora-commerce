import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectStageResponseSchema,
  RecordHistoryPageSchema,
  type ProjectDetail,
  type RecordHistoryEntry,
} from '@endora-commerce/contracts';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { removeCrmAssets, seedCrmAsset } from '../../helpers/seed-crm.js';
import { PROJECTS_AUDIT_KEYS } from '../../../../packages/modules/projects/src/backend/services/project-audit-state.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  dictionaryIds,
  getProject,
  stageNamed,
  withTasksOff,
} from './helpers.js';

/**
 * The audit-state rule for Projects (`specs/conventions/audit-state.md` §6,
 * D-288, owner rulings O-1 and O-4; issue #1226): the platform audit log is a
 * global table, so a `projects.project.*` entry carries **names and
 * structure** — a Stage, a task and a file by id or position — and never a
 * title, a description, a Stage's name, a task's title, a file's name, a note,
 * a message, a loss comment or an amount. A Stage's name, a task's title and a
 * file's name go to `project_value_changes`, written in the same Command, and
 * the Project's change history serves them from there.
 *
 * One Project, walked through every Command that writes it or a child of it,
 * every free-text field seeded with a sentinel; then every audit row about it
 * is handed to `expectNoAuditValues`, its top-level keys to
 * `PROJECTS_AUDIT_KEYS`, and the history is read back for the values.
 * Against the database, because the Commands lock and read rows a stand-in
 * would have to reimplement. Every row it writes is its own Project's, or an
 * asset it seeded and removes.
 */

const S = {
  title: 'S1226-TITLE',
  titleNew: 'S1226-TITLE-NEW',
  description: 'S1226-DESC',
  descriptionNew: 'S1226-DESC-NEW',
  stageA: 'S1226-STAGE-A',
  stageB: 'S1226-STAGE-B',
  stageC: 'S1226-STAGE-C',
  stageAdded: 'S1226-STAGE-ADDED',
  stageRenamed: 'S1226-STAGE-RENAMED',
  task: 'S1226-TASK-ONE',
  taskNew: 'S1226-TASK-ONE-NEW',
  taskTwo: 'S1226-TASK-TWO',
  taskDescription: 'S1226-TASK-DESC',
  file: 'S1226-FILE.pdf',
  note: 'S1226-NOTE',
  noteNew: 'S1226-NOTE-NEW',
  message: 'S1226-MESSAGE',
  lossComment: 'S1226-LOSS',
} as const;

const SENTINELS = [...Object.values(S), 470470.47, 470471.47];

describe('projects — the audit log carries no free text (D-288, #1226)', () => {
  let h: BackendServerHandle;
  let project: ProjectDetail;
  let addedStageId = '';
  let assetId = '';
  const created: string[] = [];
  const assets: string[] = [];

  const ok = async <R extends { statusCode: number; body: string }>(response: R, status = 200): Promise<R> => {
    expect(response.statusCode, response.body).toBe(status);
    return response;
  };
  const refresh = async () => {
    project = await getProject(h, project.id);
  };
  const stageVersion = (stageId: string) => project.stages.find((s) => s.id === stageId)!.version;
  const entries = () => h.auditLogService.query({ objectType: 'project', objectId: project.id });
  const entryOf = async (action: string, nth = 0) => {
    const found = (await entries()).filter((entry) => entry.action === action).reverse()[nth];
    expect(found, `no ${action} entry #${nth}`).toBeDefined();
    return found!;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const reasons = await dictionaryIds(h, 'project_loss_reasons');
    const asset = await seedCrmAsset(h.em(), { filename: S.file });
    assets.push(asset.id);
    assetId = asset.id;

    await withTasksOff(async () => {
      project = await createProject(h, {
        title: S.title,
        description: S.description,
        value: { amount: '470470.47', currency: 'PLN' },
        stages: [
          { name: S.stageA, color: '#3b82f6', plannedDurationDays: 2 },
          { name: S.stageB, color: '#f59e0b', plannedDurationDays: 0 },
          { name: S.stageC, color: '#22c55e', plannedDurationDays: 1 },
        ],
      });
      created.push(project.id);
      const [a, b, c] = [stageNamed(project, S.stageA), stageNamed(project, S.stageB), stageNamed(project, S.stageC)];

      await ok(
        await callProjects(h, 'PATCH', `/${project.id}`, {
          payload: {
            title: S.titleNew,
            description: S.descriptionNew,
            value: { amount: '470471.47', currency: 'PLN' },
            version: project.version,
          },
        }),
      );
      await refresh();

      const added = await ok(
        await callProjects(h, 'POST', `/${project.id}/stages`, { payload: { name: S.stageAdded, color: '#ef4444' } }),
        201,
      );
      addedStageId = ProjectStageResponseSchema.parse(added.json()).data.id;
      await refresh();
      await ok(
        await callProjects(h, 'PATCH', `/${project.id}/stages/${addedStageId}`, {
          payload: { name: S.stageRenamed, plannedDurationDays: 3, version: stageVersion(addedStageId) },
        }),
      );
      await refresh();

      await ok(
        await callProjects(h, 'PUT', `/${project.id}/stages/${b}/tasks`, {
          payload: { tasks: [{ title: S.task, description: S.taskDescription, dueOffsetDays: 1 }], version: stageVersion(b) },
        }),
      );
      await refresh();
      await ok(
        await callProjects(h, 'PUT', `/${project.id}/stages/${b}/tasks`, {
          payload: {
            tasks: [
              { title: S.taskNew, description: S.taskDescription, dueOffsetDays: 2 },
              { title: S.taskTwo, dueOffsetDays: 3 },
            ],
            version: stageVersion(b),
          },
        }),
      );
      await refresh();

      await ok(
        await callProjects(h, 'PUT', `/${project.id}/stages/order`, {
          payload: { stageIds: [a, addedStageId, b, c], configurationVersion: project.configurationVersion },
        }),
      );
      await refresh();
      await ok(
        await callProjects(h, 'PUT', `/${project.id}/moves`, {
          payload: {
            moves: [
              { fromStageId: a, toStageId: b },
              { fromStageId: b, toStageId: c },
            ],
            configurationVersion: project.configurationVersion,
          },
        }),
      );
      await ok(await callProjects(h, 'DELETE', `/${project.id}/stages/${addedStageId}`), 204);
      await refresh();

      await ok(await callProjects(h, 'POST', `/${project.id}/move`, { payload: { toStageId: b, version: project.version } }));
      await refresh();

      const note = await ok(
        await callProjects(h, 'POST', `/${project.id}/comments`, { payload: { kind: 'note', body: S.note } }),
        201,
      );
      const noteId = (note.json() as { data: { id: string } }).data.id;
      await ok(await callProjects(h, 'PATCH', `/${project.id}/comments/${noteId}`, { payload: { body: S.noteNew } }));
      await ok(await callProjects(h, 'POST', `/${project.id}/comments`, { payload: { kind: 'message', body: S.message } }), 201);
      await ok(await callProjects(h, 'DELETE', `/${project.id}/comments/${noteId}`), 204);

      const attached = await ok(await callProjects(h, 'POST', `/${project.id}/attachments`, { payload: { assetId } }), 201);
      const attachmentId = (attached.json() as { data: { id: string } }).data.id;
      await ok(await callProjects(h, 'DELETE', `/${project.id}/attachments/${attachmentId}`), 204);

      await refresh();
      await ok(
        await callProjects(h, 'POST', `/${project.id}/close`, {
          payload: { outcome: 'lost', lossReasonId: reasons.other, comment: S.lossComment, version: project.version },
        }),
      );
      await refresh();
      await ok(await callProjects(h, 'POST', `/${project.id}/reopen`, { payload: { version: project.version } }));
      await refresh();
    });
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    await removeCrmAssets(h.em(), assets);
    await teardownBackendServer(h);
  });

  it('walked every Command the sentinels reach', async () => {
    const actions = new Set((await entries()).map((entry) => entry.action));
    for (const action of [
      'projects.project.create',
      'projects.project.update',
      'projects.project.stage_create',
      'projects.project.stage_update',
      'projects.project.stage_tasks_set',
      'projects.project.stage_reorder',
      'projects.project.moves_set',
      'projects.project.stage_delete',
      'projects.project.stage_move',
      'projects.project.note_add',
      'projects.project.note_update',
      'projects.project.message_add',
      'projects.project.note_delete',
      'projects.project.attachment_add',
      'projects.project.attachment_remove',
      'projects.project.close',
      'projects.project.reopen',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
  });

  it('no audit entry carries a sentinel, at any depth', async () => {
    expectNoAuditValues(await entries(), SENTINELS);
  });

  it('every top-level key an entry carries is on PROJECTS_AUDIT_KEYS', async () => {
    const keys = new Set(
      (await entries()).flatMap((entry) => [...Object.keys(entry.stateBefore ?? {}), ...Object.keys(entry.stateAfter ?? {})]),
    );
    expect([...keys].filter((key) => !PROJECTS_AUDIT_KEYS.has(key)).sort()).toEqual([]);
  });

  it('names a Stage, a task and a file by id or position, and what changed by name', async () => {
    const create = await entryOf('projects.project.create');
    expect(create.stateAfter).toMatchObject({
      stageIds: project.stages.map((stage) => stage.id),
      changedFields: ['title', 'value'],
    });
    expect((await entryOf('projects.project.stage_create')).stateAfter).toMatchObject({
      stageId: addedStageId,
      changedFields: ['name'],
      valueChangeId: expect.any(String),
    });
    expect((await entryOf('projects.project.stage_update')).stateAfter).toMatchObject({
      stageId: addedStageId,
      plannedDurationDays: 3,
      changedFields: ['name'],
    });
    // What went points at its store row from the state before.
    expect((await entryOf('projects.project.stage_delete')).stateBefore).toMatchObject({
      stageId: addedStageId,
      changedFields: ['name'],
      valueChangeId: expect.any(String),
    });
    const tasksSecond = await entryOf('projects.project.stage_tasks_set', 1);
    expect(tasksSecond.stateAfter).toMatchObject({
      changedFields: ['taskTitles'],
      tasks: [
        { position: 1, dueOffsetDays: 2, descriptionLength: S.taskDescription.length },
        { position: 2, dueOffsetDays: 3, descriptionLength: 0 },
      ],
    });
    expect((await entryOf('projects.project.attachment_add')).stateAfter).toMatchObject({
      assetId,
      changedFields: ['fileName'],
    });
    for (const action of ['projects.project.stage_move', 'projects.project.close', 'projects.project.reopen']) {
      const entry = await entryOf(action);
      expect(Object.keys({ ...entry.stateBefore, ...entry.stateAfter }), action).not.toContain('stageName');
    }
  });

  it('the history serves the names from the Project’s own store, as older entries carried them', async () => {
    const response = await callProjects(h, 'GET', `/${project.id}/history?limit=100`);
    expect(response.statusCode, response.body).toBe(200);
    const served = RecordHistoryPageSchema.parse(response.json()).data;
    const of = (action: string, nth = 0): RecordHistoryEntry =>
      served.filter((entry) => entry.action === action).reverse()[nth]!;

    expect(of('projects.project.stage_create').after).toMatchObject({ stageId: addedStageId, name: S.stageAdded });
    expect(of('projects.project.stage_create').before).toBeNull();
    expect(of('projects.project.stage_update')).toMatchObject({
      before: { stageId: addedStageId, name: S.stageAdded },
      after: { stageId: addedStageId, name: S.stageRenamed },
    });
    // A Stage the Project no longer has keeps its name in the history.
    expect(of('projects.project.stage_delete')).toMatchObject({
      before: { stageId: addedStageId, name: S.stageRenamed },
      after: null,
    });
    expect(of('projects.project.stage_tasks_set', 0).after).toMatchObject({ tasks: [{ title: S.task, position: 1 }] });
    expect(of('projects.project.stage_tasks_set', 1)).toMatchObject({
      before: { tasks: [{ title: S.task, position: 1 }] },
      after: {
        tasks: [
          { title: S.taskNew, position: 1 },
          { title: S.taskTwo, position: 2 },
        ],
      },
    });
    expect(of('projects.project.attachment_add').after).toMatchObject({ assetId, fileName: S.file });
    // The store's values replace the names: no bookkeeping reaches the reader.
    expect(response.body).not.toContain('changedFields');
    expect(response.body).not.toContain('valueChangeId');
    expect(response.body).not.toContain('taskTitles');
  });
});
