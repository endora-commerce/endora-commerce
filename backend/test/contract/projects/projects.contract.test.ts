import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  ProjectLossReasonListResponseSchema,
  ProjectMoveResponseSchema,
  ProjectRoleListResponseSchema,
  ProjectStageEntryListResponseSchema,
  ProjectStageResponseSchema,
  SetProjectMovesResponseSchema,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  dictionaryIds,
  errorShape,
  getProject,
  plusDays,
  stageNamed,
  warsawToday,
  withTasksOff,
} from '../../integration/projects/helpers.js';

/**
 * Projects and their Stages — every endpoint of
 * `specs/163-projects-and-tasks/contracts/admin-api.md` §2.1 – §2.2 that User
 * Story 1 serves, and the two dictionary reads of §2.5 it needs: each answer
 * against its schema, each gate (401 without a session, 403 without the code),
 * and each refusal by its code.
 *
 * User Story 2's three routes — Stage Task definitions, their retry and the
 * Tasks by Stage — are gated here; their behaviour is
 * `integration/projects/stage-tasks.test.ts`.
 */
describe('projects (contract) — §2.1 Projects, §2.2 Stages and moves', () => {
  let h: BackendServerHandle;
  let orgA: string;
  let orgB: string;
  let roles: Record<string, string>;
  let reasons: Record<string, string>;
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let nobody: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const created: string[] = [];
  const dictionaryRows: Array<{ table: string; id: string }> = [];

  async function make(body: Record<string, unknown> = {}): Promise<ProjectDetail> {
    const project = await createProject(h, { title: 'Contract project', visibility: 'everyone', ...body });
    created.push(project.id);
    return project;
  }

  async function archivedRow(table: 'project_roles' | 'project_loss_reasons'): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "${table}" ("id", "code", "name", "default_name", "position", "archived_at")
         values (?, ?, '{"en":"Archived","pl":"Zarchiwizowany"}', 'Archived', 999, now())`,
        [id, `contract_archived_${id.slice(0, 8)}`],
      );
    dictionaryRows.push({ table, id });
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    orgA = await seedCrmOrganization(h.em(), 'projects contract A');
    orgB = await seedCrmOrganization(h.em(), 'projects contract B');
    roles = await dictionaryIds(h, 'project_roles');
    reasons = await dictionaryIds(h, 'project_loss_reasons');
    reader = await seedCrmAdmin(h.em(), 'projects-reader', ['projects:read']);
    nobody = await seedCrmAdmin(h.em(), 'projects-nobody', ['orders:read']);
    rep = await seedCrmSalesRep(h.em(), [orgA], ['projects:read', 'projects:write']);
  });

  afterAll(async () => {
    reader.undo();
    nobody.undo();
    rep.undo();
    await deleteProjects(h, created);
    for (const row of dictionaryRows) {
      await h.em().getConnection().execute(`delete from "${row.table}" where "id" = ?`, [row.id]);
    }
    await teardownBackendServer(h);
  });

  describe('gates', () => {
    const ID = '00000000-0000-4000-8000-0000000071a6';
    const STAGE = '00000000-0000-4000-8000-0000000071a7';
    const writes: Array<[method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string]> = [
      ['POST', ''],
      ['PATCH', `/${ID}`],
      ['DELETE', `/${ID}`],
      ['PUT', `/${ID}/organizations`],
      ['PUT', `/${ID}/members`],
      ['POST', `/${ID}/stages`],
      ['PATCH', `/${ID}/stages/${STAGE}`],
      ['DELETE', `/${ID}/stages/${STAGE}`],
      ['PUT', `/${ID}/stages/order`],
      ['PUT', `/${ID}/moves`],
      ['POST', `/${ID}/move`],
      ['POST', `/${ID}/close`],
      ['POST', `/${ID}/reopen`],
      ['PUT', `/${ID}/stages/${STAGE}/tasks`],
      ['POST', `/${ID}/stages/${STAGE}/materialize-tasks`],
    ];
    const reads = ['', `/${ID}`, `/${ID}/stage-history`, '/roles', '/loss-reasons', `/${ID}/tasks`];

    it('every route answers 401 without a session', async () => {
      for (const path of reads) {
        expect((await callProjects(h, 'GET', path, { cookies: null })).statusCode, `GET ${path}`).toBe(401);
      }
      for (const [method, path] of writes) {
        expect((await callProjects(h, method, path, { cookies: null, payload: {} })).statusCode, `${method} ${path}`).toBe(
          401,
        );
      }
    });

    it('reads need projects:read; writes need projects:write — 403 otherwise', async () => {
      for (const path of reads) {
        expect((await callProjects(h, 'GET', path, { cookies: nobody.cookies })).statusCode, `GET ${path}`).toBe(403);
      }
      for (const [method, path] of writes) {
        const response = await callProjects(h, method, path, { cookies: reader.cookies, payload: {} });
        expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(403);
      }
    });
  });

  describe('POST /projects', () => {
    it('answers 201 with a ProjectDetail', async () =>
      withTasksOff(async () => {
        const response = await callProjects(h, 'POST', '', {
          payload: {
            title: '  Warehouse racking  ',
            description: 'Phase one',
            value: { amount: '1000.00', currency: 'EUR' },
            startOn: '2026-11-02',
            organizationIds: [orgA],
            members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles.project_manager] }],
            visibility: 'members_and_listed',
            viewerIds: [reader.adminUserId],
            stages: [{ name: 'Survey', color: '#0ea5e9', plannedDurationDays: 2, alertOffsetsDays: [1] }],
          },
        });
        expect(response.statusCode, response.body).toBe(201);
        const { data } = ProjectDetailResponseSchema.parse(response.json());
        created.push(data.id);
        expect(data).toMatchObject({
          title: 'Warehouse racking',
          description: 'Phase one',
          startOn: '2026-11-02',
          visibility: 'members_and_listed',
          viewers: [{ id: reader.adminUserId }],
          template: null,
          references: [],
          linkCount: 0,
          unreadMessageCount: 0,
          customFieldValues: {},
          permissions: { canWrite: true, canConfigure: true },
        });
        // A single Stage is the last: completing is permitted from it.
        expect(data.stages).toEqual([
          expect.objectContaining({ name: 'Survey', alertOffsetsDays: [1], completionPermitted: true, stageTasks: [] }),
        ]);
        expect(data.members[0]).toMatchObject({
          adminUser: { id: TEST_ADMIN_ID, active: true },
          roles: [{ id: roles.project_manager, name: 'Project Manager', archived: false }],
        });
      }));

    it('answers 400 for a body its schema refuses', async () => {
      const response = await callProjects(h, 'POST', '', { payload: { title: '', organizationIds: [] } });
      expect(response.statusCode, response.body).toBe(400);
    });

    it('refuses a Project with no Stage and no Template — 422 VALIDATION_FAILED', async () => {
      const response = await callProjects(h, 'POST', '', { payload: { title: 'No stages', organizationIds: [] } });
      expect(response.statusCode, response.body).toBe(422);
      expect(errorShape(response.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('refuses an Organization out of the caller’s reach — 422 PROJECT_ORGANIZATION_OUT_OF_SCOPE', async () => {
      const response = await callProjects(h, 'POST', '', {
        cookies: rep.cookies,
        payload: { title: 'Out of reach', organizationIds: [orgA, orgB], stages: [{ name: 'S', color: '#000000' }] },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_ORGANIZATION_OUT_OF_SCOPE' });
      const unknown = await callProjects(h, 'POST', '', {
        payload: { title: 'Unknown', organizationIds: [randomUUID()], stages: [{ name: 'S', color: '#000000' }] },
      });
      expect(unknown.statusCode, unknown.body).toBe(422);
      expect(errorShape(unknown.body)).toMatchObject({ code: 'PROJECT_ORGANIZATION_OUT_OF_SCOPE' });
    });

    it('a representative creates a Project of the Organization they reach', async () =>
      withTasksOff(async () => {
        const project = await createProject(h, { title: 'Rep’s own', organizationIds: [orgA] }, rep.cookies);
        created.push(project.id);
        expect(project.organizations.map((o) => o.id)).toEqual([orgA]);
      }));

    it('refuses a Member who is no active administrator, or a Role that does not exist — 422 PROJECT_MEMBER_INVALID', async () => {
      for (const members of [
        [{ adminUserId: randomUUID(), roleIds: [] }],
        [{ adminUserId: TEST_ADMIN_ID, roleIds: [randomUUID()] }],
      ]) {
        const response = await callProjects(h, 'POST', '', {
          payload: { title: 'Bad member', organizationIds: [], members, stages: [{ name: 'S', color: '#000000' }] },
        });
        expect(response.statusCode, response.body).toBe(422);
        expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_MEMBER_INVALID' });
      }
    });
  });

  describe('GET /projects and GET /projects/:id', () => {
    it('lists against ProjectListResponse and reads a ProjectDetail', async () =>
      withTasksOff(async () => {
        const project = await make({ organizationIds: [orgA] });
        const list = await callProjects(h, 'GET', `?q=${encodeURIComponent(project.number)}`);
        expect(list.statusCode, list.body).toBe(200);
        expect(ProjectListResponseSchema.parse(list.json())).toMatchObject({ total: 1, items: [{ id: project.id }] });

        const detail = await callProjects(h, 'GET', `/${project.id}`, { cookies: reader.cookies });
        expect(detail.statusCode, detail.body).toBe(200);
        expect(ProjectDetailResponseSchema.parse(detail.json()).data).toMatchObject({
          id: project.id,
          permissions: { canWrite: false, canConfigure: false },
        });
      }));

    it('answers 404 PROJECT_NOT_FOUND for an unknown id', async () => {
      const response = await callProjects(h, 'GET', `/${randomUUID()}`);
      expect(response.statusCode, response.body).toBe(404);
      expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    });
  });

  describe('PATCH /projects/:id', () => {
    it('edits title, description, value and start date, and bumps the version', async () =>
      withTasksOff(async () => {
        const project = await make({ value: { amount: '10.00', currency: 'PLN' } });
        const response = await callProjects(h, 'PATCH', `/${project.id}`, {
          payload: { title: 'Renamed', description: 'More', startOn: '2027-01-04', value: null, version: project.version },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(ProjectDetailResponseSchema.parse(response.json()).data).toMatchObject({
          title: 'Renamed',
          description: 'More',
          startOn: '2027-01-04',
          value: null,
          version: project.version + 1,
        });
      }));

    it('refuses a stale version — 409 PROJECT_CHANGED', async () =>
      withTasksOff(async () => {
        const project = await make();
        const response = await callProjects(h, 'PATCH', `/${project.id}`, {
          payload: { title: 'Late', version: project.version + 7 },
        });
        expect(response.statusCode, response.body).toBe(409);
        expect(errorShape(response.body)).toMatchObject({ code: 'PROJECT_CHANGED' });
      }));
  });

  describe('DELETE /projects/:id', () => {
    it('refuses while records are linked — 409 PROJECT_HAS_LINKS — and deletes once they are not', async () =>
      withTasksOff(async () => {
        const project = await make({ organizationIds: [orgA] });
        const linkId = randomUUID();
        await h
          .em()
          .getConnection()
          .execute(
            `insert into "project_links" ("id", "project_id", "record_kind", "record_id", "organization_id")
             values (?, ?, 'order', ?, ?)`,
            [linkId, project.id, randomUUID(), orgA],
          );
        const refused = await callProjects(h, 'DELETE', `/${project.id}`);
        expect(refused.statusCode, refused.body).toBe(409);
        expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_HAS_LINKS' });

        await h.em().getConnection().execute(`delete from "project_links" where "id" = ?`, [linkId]);
        expect((await callProjects(h, 'DELETE', `/${project.id}`)).statusCode).toBe(204);
        expect((await callProjects(h, 'GET', `/${project.id}`)).statusCode).toBe(404);
      }));
  });

  describe('PUT /projects/:id/organizations and /members', () => {
    it('replaces the Organizations; refuses one out of reach', async () =>
      withTasksOff(async () => {
        const project = await make({ organizationIds: [orgA] });
        const response = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
          payload: { organizationIds: [orgB] },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(ProjectDetailResponseSchema.parse(response.json()).data.organizations.map((o) => o.id)).toEqual([orgB]);

        const refused = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
          payload: { organizationIds: [orgB, randomUUID()] },
        });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_ORGANIZATION_OUT_OF_SCOPE' });
      }));

    it('replaces the Members and their Roles; refuses an invalid one', async () =>
      withTasksOff(async () => {
        const project = await make({
          members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roles.sales_rep] }],
        });
        const response = await callProjects(h, 'PUT', `/${project.id}/members`, {
          payload: {
            members: [
              { adminUserId: TEST_ADMIN_ID, roleIds: [roles.project_manager, roles.sales_rep] },
              { adminUserId: reader.adminUserId, roleIds: [] },
            ],
          },
        });
        expect(response.statusCode, response.body).toBe(200);
        const members = ProjectDetailResponseSchema.parse(response.json()).data.members;
        expect(members.map((m) => [m.adminUser.id, m.roles.map((r) => r.id).sort()])).toEqual(
          expect.arrayContaining([
            [TEST_ADMIN_ID, [roles.project_manager, roles.sales_rep].sort()],
            [reader.adminUserId, []],
          ]),
        );

        const archived = await archivedRow('project_roles');
        const refused = await callProjects(h, 'PUT', `/${project.id}/members`, {
          payload: { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [archived] }] },
        });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_MEMBER_INVALID' });
      }));
  });

  describe('Stages', () => {
    it('POST adds a Stage at the end, the previous last Stage moving to it', async () =>
      withTasksOff(async () => {
        const project = await make();
        const response = await callProjects(h, 'POST', `/${project.id}/stages`, {
          payload: { name: 'Snagging', color: '#ef4444', plannedDurationDays: 3, responsibleRoleIds: [roles.project_manager] },
        });
        expect(response.statusCode, response.body).toBe(201);
        const stage = ProjectStageResponseSchema.parse(response.json()).data;
        expect(stage).toMatchObject({ name: 'Snagging', position: 4, responsibleRoleIds: [roles.project_manager] });
        const after = await getProject(h, project.id);
        expect(after.moves).toContainEqual({ fromStageId: stageNamed(project, 'Handover'), toStageId: stage.id });
        expect(after.unreachableStageIds).toEqual([]);

        const bad = await callProjects(h, 'POST', `/${project.id}/stages`, { payload: { name: 'X', color: 'red' } });
        expect(bad.statusCode, bad.body).toBe(400);
      }));

    it('PATCH edits a Stage: a manual deadline, then null to recompute from its duration', async () =>
      withTasksOff(async () => {
        const project = await make();
        const design = stageNamed(project, 'Design');
        const manual = await callProjects(h, 'PATCH', `/${project.id}/stages/${design}`, {
          payload: { deadlineOn: '2030-01-01', name: 'Concept' },
        });
        expect(manual.statusCode, manual.body).toBe(200);
        expect(ProjectStageResponseSchema.parse(manual.json()).data).toMatchObject({
          name: 'Concept',
          deadlineOn: '2030-01-01',
          deadlineManual: true,
        });
        const recomputed = await callProjects(h, 'PATCH', `/${project.id}/stages/${design}`, {
          payload: { deadlineOn: null, plannedDurationDays: 3 },
        });
        expect(recomputed.statusCode, recomputed.body).toBe(200);
        expect(ProjectStageResponseSchema.parse(recomputed.json()).data).toMatchObject({
          deadlineOn: plusDays(warsawToday(), 3),
          deadlineManual: false,
        });

        const foreign = await callProjects(h, 'PATCH', `/${project.id}/stages/${randomUUID()}`, {
          payload: { name: 'Nowhere' },
        });
        expect(foreign.statusCode, foreign.body).toBe(404);
      }));

    it('DELETE refuses the current Stage and the only Stage, and removes another', async () =>
      withTasksOff(async () => {
        const project = await make();
        const current = await callProjects(h, 'DELETE', `/${project.id}/stages/${stageNamed(project, 'Design')}`);
        expect(current.statusCode, current.body).toBe(409);
        expect(errorShape(current.body)).toMatchObject({ code: 'PROJECT_STAGE_CURRENT' });

        const removed = await callProjects(h, 'DELETE', `/${project.id}/stages/${stageNamed(project, 'Build')}`);
        expect(removed.statusCode, removed.body).toBe(204);
        const after = await getProject(h, project.id);
        expect(after.stages.map((s) => [s.name, s.position])).toEqual([
          ['Design', 1],
          ['Handover', 2],
        ]);

        const single = await make({ stages: [{ name: 'Only', color: '#64748b' }] });
        const last = await callProjects(h, 'DELETE', `/${single.id}/stages/${stageNamed(single, 'Only')}`);
        expect(last.statusCode, last.body).toBe(409);
        expect(errorShape(last.body)).toMatchObject({ code: 'PROJECT_STAGE_LAST' });
      }));

    it('PUT /stages/order reorders every Stage; a set that is not the Project’s is refused', async () =>
      withTasksOff(async () => {
        const project = await make();
        const reversed = [...project.stages].reverse().map((s) => s.id);
        const response = await callProjects(h, 'PUT', `/${project.id}/stages/order`, { payload: { stageIds: reversed } });
        expect(response.statusCode, response.body).toBe(200);
        expect(ProjectDetailResponseSchema.parse(response.json()).data.stages.map((s) => s.name)).toEqual([
          'Handover',
          'Build',
          'Design',
        ]);
        const partial = await callProjects(h, 'PUT', `/${project.id}/stages/order`, {
          payload: { stageIds: reversed.slice(1) },
        });
        expect(partial.statusCode, partial.body).toBe(422);
        expect(errorShape(partial.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
      }));

    it('PUT /moves replaces the workflow and names the Stages it leaves unreachable', async () =>
      withTasksOff(async () => {
        const project = await make();
        const [design, build, handover] = project.stages.map((s) => s.id) as [string, string, string];
        const response = await callProjects(h, 'PUT', `/${project.id}/moves`, {
          payload: {
            moves: [
              { fromStageId: design, toStageId: handover },
              { fromStageId: handover, toStageId: design },
            ],
          },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(SetProjectMovesResponseSchema.parse(response.json()).data).toEqual({
          moves: [
            { fromStageId: design, toStageId: handover },
            { fromStageId: handover, toStageId: design },
          ],
          unreachableStageIds: [build],
          // The configuration version the write left the Project at (issue #449).
          configurationVersion: project.configurationVersion + 1,
        });
        const foreign = await callProjects(h, 'PUT', `/${project.id}/moves`, {
          payload: { moves: [{ fromStageId: design, toStageId: randomUUID() }] },
        });
        expect(foreign.statusCode, foreign.body).toBe(422);
        expect(errorShape(foreign.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
      }));
  });

  describe('move, close, reopen and the Stage history', () => {
    it('POST /move answers a MoveResult; refuses a move not permitted and a stale version', async () =>
      withTasksOff(async () => {
        const project = await make();
        const refused = await callProjects(h, 'POST', `/${project.id}/move`, {
          payload: { toStageId: stageNamed(project, 'Handover'), version: project.version },
        });
        expect(refused.statusCode, refused.body).toBe(409);
        expect(errorShape(refused.body)).toMatchObject({ code: 'PROJECT_MOVE_NOT_PERMITTED' });

        const response = await callProjects(h, 'POST', `/${project.id}/move`, {
          payload: { toStageId: stageNamed(project, 'Build'), version: project.version },
        });
        expect(response.statusCode, response.body).toBe(200);
        const result = ProjectMoveResponseSchema.parse(response.json()).data;
        expect(result).toMatchObject({ createdTaskIds: [], notes: [], entry: { kind: 'enter', toStageName: 'Build' } });

        const stale = await callProjects(h, 'POST', `/${project.id}/move`, {
          payload: { toStageId: stageNamed(project, 'Handover'), version: project.version },
        });
        expect(stale.statusCode, stale.body).toBe(409);
        expect(errorShape(stale.body)).toMatchObject({ code: 'PROJECT_CHANGED' });
      }));

    it('POST /close refuses completing where not permitted and an archived loss reason', async () =>
      withTasksOff(async () => {
        const project = await make();
        const completed = await callProjects(h, 'POST', `/${project.id}/close`, {
          payload: { outcome: 'completed', version: project.version },
        });
        expect(completed.statusCode, completed.body).toBe(409);
        expect(errorShape(completed.body)).toMatchObject({ code: 'PROJECT_COMPLETION_NOT_PERMITTED' });

        const archived = await archivedRow('project_loss_reasons');
        const lost = await callProjects(h, 'POST', `/${project.id}/close`, {
          payload: { outcome: 'lost', lossReasonId: archived, version: project.version },
        });
        expect(lost.statusCode, lost.body).toBe(422);
        expect(errorShape(lost.body)).toMatchObject({ code: 'PROJECT_LOSS_REASON_INVALID' });
      }));

    it('POST /close and /reopen answer a ProjectDetail; reopening an open Project is refused', async () =>
      withTasksOff(async () => {
        const project = await make();
        const open = await callProjects(h, 'POST', `/${project.id}/reopen`, { payload: { version: project.version } });
        expect(open.statusCode, open.body).toBe(409);
        expect(errorShape(open.body)).toMatchObject({ code: 'PROJECT_MOVE_NOT_PERMITTED' });

        const closed = await callProjects(h, 'POST', `/${project.id}/close`, {
          payload: { outcome: 'lost', lossReasonId: reasons.price, version: project.version },
        });
        expect(closed.statusCode, closed.body).toBe(200);
        const lost = ProjectDetailResponseSchema.parse(closed.json()).data;
        expect(lost).toMatchObject({ state: 'lost', lossReason: { id: reasons.price, name: 'Price' } });

        const again = await callProjects(h, 'POST', `/${project.id}/close`, {
          payload: { outcome: 'lost', lossReasonId: reasons.price, version: lost.version },
        });
        expect(again.statusCode, again.body).toBe(409);
        expect(errorShape(again.body)).toMatchObject({ code: 'PROJECT_MOVE_NOT_PERMITTED' });

        const reopened = await callProjects(h, 'POST', `/${project.id}/reopen`, { payload: { version: lost.version } });
        expect(reopened.statusCode, reopened.body).toBe(200);
        expect(ProjectDetailResponseSchema.parse(reopened.json()).data.state).toBe('open');
      }));

    it('GET /stage-history answers StageEntry[] oldest first', async () =>
      withTasksOff(async () => {
        const project = await make();
        const response = await callProjects(h, 'GET', `/${project.id}/stage-history`);
        expect(response.statusCode, response.body).toBe(200);
        expect(ProjectStageEntryListResponseSchema.parse(response.json()).data).toEqual([
          expect.objectContaining({
            kind: 'enter',
            fromStageId: null,
            toStageName: 'Design',
            actor: expect.objectContaining({ id: TEST_ADMIN_ID }),
          }),
        ]);
        expect((await callProjects(h, 'GET', `/${randomUUID()}/stage-history`)).statusCode).toBe(404);
      }));
  });

  describe('GET /projects/roles and /projects/loss-reasons', () => {
    it('lists the seeded Roles with their names, the label in the response language', async () => {
      // An administrator's response language is their stored preference.
      const setLanguage = (language: string | null) =>
        h
          .em()
          .getConnection()
          .execute(`update "admin_users" set "preferred_language" = ? where "id" = ?`, [language, reader.adminUserId]);
      await setLanguage('pl');
      const response = await callProjects(h, 'GET', '/roles', { cookies: reader.cookies }).finally(() => setLanguage(null));
      expect(response.statusCode, response.body).toBe(200);
      const rows = ProjectRoleListResponseSchema.parse(response.json()).data;
      expect(rows.find((row) => row.code === 'project_manager')).toMatchObject({
        isSystem: true,
        label: 'Kierownik Projektu',
        name: { en: 'Project Manager', pl: 'Kierownik Projektu' },
      });
    });

    it('`active=true` leaves archived rows out; without it they are listed', async () => {
      const archived = await archivedRow('project_loss_reasons');
      const all = ProjectLossReasonListResponseSchema.parse(
        (await callProjects(h, 'GET', '/loss-reasons', { cookies: reader.cookies })).json(),
      ).data;
      expect(all.map((row) => row.id)).toContain(archived);
      expect(all.slice(0, 5).map((row) => row.code)).toEqual([
        'price',
        'competitor',
        'cancelled_by_client',
        'no_decision',
        'other',
      ]);
      const active = ProjectLossReasonListResponseSchema.parse(
        (await callProjects(h, 'GET', '/loss-reasons?active=true')).json(),
      ).data;
      expect(active.map((row) => row.id)).not.toContain(archived);
      expect(active.find((row) => row.code === 'price')).toMatchObject({ label: 'Price', archivedAt: null });
    });
  });
});
