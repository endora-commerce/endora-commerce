import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectDetailResponseSchema, ProjectStageResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmOrganization } from '../../helpers/seed-crm.js';
import {
  callProjects,
  closeProject,
  createProject,
  deleteProjects,
  dictionaryIds,
  getProject,
  moveProjectOk,
  reopenProject,
  stageNamed,
  withTasksOff,
} from './helpers.js';

/**
 * Uniform write auditing (Constitution XIII, `data-model.md` §2.4): every
 * write of User Story 1 runs through the Command Bus and leaves exactly one
 * audit row per Command, named by its action, with `objectType: 'project'` and
 * the Project's id — and a refused write leaves none.
 *
 * `PUT /organizations` runs one child Command per Organization added or
 * removed inside one transaction (issue #449), so the trail says
 * `organization_add` and `organization_remove` by name.
 */
describe('projects — audit coverage of User Story 1 (XIII)', () => {
  let h: BackendServerHandle;
  let project: ProjectDetail;
  let orgA: string;
  let orgB: string;
  let roles: Record<string, string>;
  let reasons: Record<string, string>;
  const created: string[] = [];

  async function rows(objectId: string) {
    return h.auditLogService.query({ objectId });
  }

  /** Run `write` and return the audit rows it added for the Project. */
  async function added(write: () => Promise<{ statusCode: number; body: string }>, expected = 200) {
    const before = (await rows(project.id)).length;
    const response = await write();
    expect(response.statusCode, response.body).toBe(expected);
    const after = await rows(project.id);
    return after.slice(0, after.length - before);
  }

  async function refresh() {
    project = await getProject(h, project.id);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    orgA = await seedCrmOrganization(h.em(), 'projects audit A');
    orgB = await seedCrmOrganization(h.em(), 'projects audit B');
    roles = await dictionaryIds(h, 'project_roles');
    reasons = await dictionaryIds(h, 'project_loss_reasons');
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  function expectOne(entries: Array<{ action: string; objectType: string; objectId: string }>, action: string) {
    expect(entries.map((entry) => entry.action)).toEqual([action]);
    expect(entries[0]).toMatchObject({ objectType: 'project', objectId: project.id });
  }

  it('create — projects.project.create, by the acting administrator', async () =>
    withTasksOff(async () => {
      project = await createProject(h, { title: 'Audited', organizationIds: [orgA] });
      created.push(project.id);
      const entries = await rows(project.id);
      expectOne(entries, 'projects.project.create');
      expect(entries[0]).toMatchObject({ actorAdminUserId: TEST_ADMIN_ID });
    }));

  it('update — projects.project.update', async () =>
    withTasksOff(async () => {
      expectOne(
        await added(() => callProjects(h, 'PATCH', `/${project.id}`, { payload: { title: 'Audited, renamed', version: project.version } })),
        'projects.project.update',
      );
      await refresh();
    }));

  it('organizations — one organization_add and one organization_remove', async () =>
    withTasksOff(async () => {
      expectOne(
        await added(() => callProjects(h, 'PUT', `/${project.id}/organizations`, { payload: { organizationIds: [orgA, orgB] } })),
        'projects.project.organization_add',
      );
      expectOne(
        await added(() => callProjects(h, 'PUT', `/${project.id}/organizations`, { payload: { organizationIds: [orgB] } })),
        'projects.project.organization_remove',
      );
    }));

  it('members — projects.project.member_set', async () =>
    withTasksOff(async () => {
      expectOne(
        await added(() =>
          callProjects(h, 'PUT', `/${project.id}/members`, {
            payload: { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles.project_manager] }] },
          }),
        ),
        'projects.project.member_set',
      );
    }));

  it('stages — stage_create, stage_update, stage_reorder, moves_set, stage_delete', async () =>
    withTasksOff(async () => {
      let stageId = '';
      const createdStage = await added(async () => {
        const response = await callProjects(h, 'POST', `/${project.id}/stages`, {
          payload: { name: 'Snagging', color: '#ef4444', plannedDurationDays: 3 },
        });
        if (response.statusCode === 201) stageId = ProjectStageResponseSchema.parse(response.json()).data.id;
        return response;
      }, 201);
      expectOne(createdStage, 'projects.project.stage_create');

      expectOne(
        await added(() => callProjects(h, 'PATCH', `/${project.id}/stages/${stageId}`, { payload: { plannedDurationDays: 4 } })),
        'projects.project.stage_update',
      );
      await refresh();
      const order = project.stages.map((s) => s.id).reverse();
      expectOne(
        await added(() => callProjects(h, 'PUT', `/${project.id}/stages/order`, { payload: { stageIds: order } })),
        'projects.project.stage_reorder',
      );
      expectOne(
        await added(() =>
          callProjects(h, 'PUT', `/${project.id}/moves`, {
            payload: { moves: [{ fromStageId: stageNamed(project, 'Design'), toStageId: stageNamed(project, 'Build') }] },
          }),
        ),
        'projects.project.moves_set',
      );
      expectOne(
        await added(() => callProjects(h, 'DELETE', `/${project.id}/stages/${stageId}`), 204),
        'projects.project.stage_delete',
      );
      await refresh();
    }));

  it('move, close and reopen — stage_move, close, reopen', async () =>
    withTasksOff(async () => {
      expectOne(
        await added(async () => {
          const result = await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
          project = result.project;
          return { statusCode: 200, body: '' };
        }),
        'projects.project.stage_move',
      );
      let version = project.version;
      expectOne(
        await added(async () => {
          const response = await closeProject(h, project.id, {
            outcome: 'lost',
            lossReasonId: reasons.other,
            comment: 'Never written to the trail',
            version,
          });
          if (response.statusCode === 200) version = ProjectDetailResponseSchema.parse(response.json()).data.version;
          return response;
        }),
        'projects.project.close',
      );
      const close = (await rows(project.id)).find((entry) => entry.action === 'projects.project.close')!;
      expect(JSON.stringify(close)).not.toContain('Never written to the trail');
      expectOne(await added(() => reopenProject(h, project.id, version)), 'projects.project.reopen');
    }));

  it('a refused write leaves no row', async () =>
    withTasksOff(async () => {
      const entries = await added(
        () => callProjects(h, 'PATCH', `/${project.id}`, { payload: { title: 'Stale', version: 1 } }),
        409,
      );
      expect(entries).toEqual([]);
    }));

  it('delete — projects.project.delete', async () =>
    withTasksOff(async () => {
      expectOne(await added(() => callProjects(h, 'DELETE', `/${project.id}`), 204), 'projects.project.delete');
    }));
});
