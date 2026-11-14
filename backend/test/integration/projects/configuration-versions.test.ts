import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SetProjectMovesResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { seedCrmOrganization } from '../../helpers/seed-crm.js';
import type { ProjectService } from '../../../../packages/modules/projects/src/backend/services/project-service.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  getProject,
  moveProjectOk,
  stageNamed,
  withTasksOff,
} from './helpers.js';

/**
 * Optimistic concurrency for a Project's configuration (issue #449,
 * `specs/163-projects-and-tasks/`).
 *
 * **Two tokens, neither of them the Project `version`.** A Stage's own edits —
 * `PATCH …/stages/:stageId` and `PUT …/stages/:stageId/tasks` — name the
 * Stage's `version`; the Project's sets — `POST …/stages`, `PUT …/stages/order`,
 * `PUT …/moves`, `PUT …/organizations` and `PUT …/members` — name its
 * `configurationVersion`, which `DELETE …/stages/:stageId` moves too. Both are
 * optional, so a client that sends none is served as before; sent and stale,
 * the write answers 409 `PROJECT_CHANGED` and writes nothing. The Project
 * `version` — what moves, closes, reopens and edits name — is left alone, so a
 * client that edited a Stage and then moves the Project with the version it
 * read is served exactly as before (the additive answer to the issue).
 *
 * `PUT /organizations` is **one** transaction: a failure part-way leaves the
 * set as it was, while the trail still names each Organization added or
 * removed (`organization_add` / `organization_remove`, `data-model.md` §2.4).
 */
describe('projects — version checks on configuration writes (#449)', () => {
  let h: BackendServerHandle;
  let orgA: string;
  let orgB: string;
  const created: string[] = [];

  const fresh = async (title: string): Promise<ProjectDetail> => {
    const project = await createProject(h, { title: `versions ${title}`, organizationIds: [orgA] });
    created.push(project.id);
    return project;
  };
  const auditRows = (objectId: string) => h.auditLogService.query({ objectId });
  const stageOf = (project: ProjectDetail, name: string) => project.stages.find((s) => s.name === name)!;

  type Write = [
    label: string,
    method: 'POST' | 'PUT',
    path: (p: ProjectDetail) => string,
    body: (p: ProjectDetail) => Record<string, unknown>,
  ];
  /** The Project's sets, each held to `configurationVersion`. */
  const configurationWrites: Write[] = [
    ['create a Stage', 'POST', (p) => `/${p.id}/stages`, () => ({ name: 'Snagging', color: '#ef4444' })],
    ['reorder the Stages', 'PUT', (p) => `/${p.id}/stages/order`, (p) => ({ stageIds: p.stages.map((s) => s.id).reverse() })],
    [
      'set the workflow',
      'PUT',
      (p) => `/${p.id}/moves`,
      (p) => ({ moves: [{ fromStageId: stageNamed(p, 'Design'), toStageId: stageNamed(p, 'Build') }] }),
    ],
    ['set the Organizations', 'PUT', (p) => `/${p.id}/organizations`, () => ({ organizationIds: [orgA, orgB] })],
    ['set the Members', 'PUT', (p) => `/${p.id}/members`, () => ({ members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [] }] })],
  ];
  /** A Stage's own edits, each held to that Stage's `version`. */
  const stageWrites: Array<[label: string, method: 'PATCH' | 'PUT', suffix: string, body: Record<string, unknown>]> = [
    ['edit a Stage', 'PATCH', '', { plannedDurationDays: 4 }],
    ['set a Stage’s Tasks', 'PUT', '/tasks', { tasks: [{ title: 'Measure', dueOffsetDays: 0 }] }],
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
    orgA = await seedCrmOrganization(h.em(), 'projects versions A');
    orgB = await seedCrmOrganization(h.em(), 'projects versions B');
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('a Project and each of its Stages start at version 1', async () =>
    withTasksOff(async () => {
      const project = await fresh('start');
      expect(project.configurationVersion).toBe(1);
      expect(project.stages.map((s) => s.version)).toEqual([1, 1, 1]);
    }));

  it('two administrators editing one Stage from the same read: the second is refused, nothing of it written', async () =>
    withTasksOff(async () => {
      const read = await fresh('same stage');
      const design = stageOf(read, 'Design');
      const first = await callProjects(h, 'PATCH', `/${read.id}/stages/${design.id}`, {
        payload: { plannedDurationDays: 7, version: design.version },
      });
      expect(first.statusCode, first.body).toBe(200);
      const rowsBefore = (await auditRows(read.id)).length;

      const second = await callProjects(h, 'PATCH', `/${read.id}/stages/${design.id}`, {
        payload: { plannedDurationDays: 3, version: design.version },
      });
      expect(second.statusCode, second.body).toBe(409);
      expect(second.json()).toMatchObject({ error: { code: 'PROJECT_CHANGED' } });
      const after = await getProject(h, read.id);
      expect(stageOf(after, 'Design')).toMatchObject({ plannedDurationDays: 7, version: design.version + 1 });
      expect(await auditRows(read.id)).toHaveLength(rowsBefore);
    }));

  it('a Stage version is the Stage’s own: editing one Stage does not refuse an edit of another', async () =>
    withTasksOff(async () => {
      const read = await fresh('two stages');
      const design = stageOf(read, 'Design');
      const build = stageOf(read, 'Build');
      const one = await callProjects(h, 'PATCH', `/${read.id}/stages/${design.id}`, {
        payload: { plannedDurationDays: 7, version: design.version },
      });
      expect(one.statusCode, one.body).toBe(200);
      const other = await callProjects(h, 'PATCH', `/${read.id}/stages/${build.id}`, {
        payload: { plannedDurationDays: 2, version: build.version },
      });
      expect(other.statusCode, other.body).toBe(200);
    }));

  describe.each(stageWrites)('%s', (label, method, suffix, body) => {
    it('with a stale Stage version answers 409 PROJECT_CHANGED and writes nothing; with the current one it moves the Stage version only', async () =>
      withTasksOff(async () => {
        const project = await fresh(`stage ${label}`);
        const design = stageOf(project, 'Design');
        const path = `/${project.id}/stages/${design.id}${suffix}`;
        // Somebody else edits the Stage first.
        const other = await callProjects(h, 'PATCH', `/${project.id}/stages/${design.id}`, {
          payload: { name: 'Design, renamed', version: design.version },
        });
        expect(other.statusCode, other.body).toBe(200);

        const rowsBefore = (await auditRows(project.id)).length;
        const stale = await callProjects(h, method, path, { payload: { ...body, version: design.version } });
        expect(stale.statusCode, `${label}: ${stale.body}`).toBe(409);
        expect(stale.json()).toMatchObject({ error: { code: 'PROJECT_CHANGED' } });
        expect(await auditRows(project.id), label).toHaveLength(rowsBefore);

        const current = await getProject(h, project.id);
        const ok = await callProjects(h, method, path, {
          payload: { ...body, version: stageOf(current, 'Design, renamed').version },
        });
        expect(ok.statusCode, `${label}: ${ok.body}`).toBe(200);
        const after = await getProject(h, project.id);
        expect(stageOf(after, 'Design, renamed').version, label).toBe(design.version + 2);
        expect(after.version, label).toBe(project.version);
        expect(after.configurationVersion, label).toBe(project.configurationVersion);
      }));
  });

  describe.each(configurationWrites)('%s', (label, method, path, body) => {
    it('with a stale configurationVersion answers 409 PROJECT_CHANGED and writes nothing; with the current one it moves that version only', async () =>
      withTasksOff(async () => {
        const project = await fresh(`configuration ${label}`);
        // Somebody else changes the Project's configuration first.
        const other = await callProjects(h, 'PUT', `/${project.id}/moves`, {
          payload: { moves: [], configurationVersion: project.configurationVersion },
        });
        expect(other.statusCode, other.body).toBe(200);

        const rowsBefore = (await auditRows(project.id)).length;
        const stale = await callProjects(h, method, path(project), {
          payload: { ...body(project), configurationVersion: project.configurationVersion },
        });
        expect(stale.statusCode, `${label}: ${stale.body}`).toBe(409);
        expect(stale.json()).toMatchObject({ error: { code: 'PROJECT_CHANGED' } });
        expect(await auditRows(project.id), label).toHaveLength(rowsBefore);

        const current = await getProject(h, project.id);
        const ok = await callProjects(h, method, path(current), {
          payload: { ...body(current), configurationVersion: current.configurationVersion },
        });
        expect(ok.statusCode, `${label}: ${ok.body}`).toBeLessThan(300);
        const after = await getProject(h, project.id);
        expect(after.configurationVersion, label).toBe(current.configurationVersion + 1);
        expect(after.version, label).toBe(project.version);
      }));
  });

  it('without a version every write is served as before; none moves the Project version a move names', async () =>
    withTasksOff(async () => {
      const project = await fresh('no version');
      for (const [label, method, path, body] of configurationWrites) {
        const now = await getProject(h, project.id);
        const response = await callProjects(h, method, path(now), { payload: body(now) });
        expect(response.statusCode, `${label}: ${response.body}`).toBeLessThan(300);
      }
      for (const [label, method, suffix, body] of stageWrites) {
        const response = await callProjects(h, method, `/${project.id}/stages/${stageNamed(project, 'Design')}${suffix}`, {
          payload: body,
        });
        expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
      }
      const deleted = await callProjects(h, 'DELETE', `/${project.id}/stages/${stageNamed(project, 'Handover')}`);
      expect(deleted.statusCode, deleted.body).toBe(204);

      const after = await getProject(h, project.id);
      expect(after.configurationVersion).toBe(project.configurationVersion + configurationWrites.length + 1);
      expect(after.version).toBe(project.version);
      // A client that read the Project before all of that moves it as it always could.
      await moveProjectOk(h, project.id, stageNamed(project, 'Build'), project.version);
    }));

  it('PUT /moves answers the configurationVersion it left the Project at', async () =>
    withTasksOff(async () => {
      const read = await fresh('moves answer');
      const response = await callProjects(h, 'PUT', `/${read.id}/moves`, {
        payload: {
          moves: [{ fromStageId: stageNamed(read, 'Design'), toStageId: stageNamed(read, 'Handover') }],
          configurationVersion: read.configurationVersion,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(SetProjectMovesResponseSchema.parse(response.json()).data.configurationVersion).toBe(
        read.configurationVersion + 1,
      );
    }));

  it('PUT /organizations is one transaction: a failure part-way leaves the set and the trail as they were', async () =>
    withTasksOff(async () => {
      const project = await fresh('atomic organizations');
      // An Organization that passes every check made before the write and then
      // does not exist when it is inserted — the foreign key refuses it, after
      // orgB has been added and before orgA has been removed.
      const ghost = '00000000-0000-4000-8000-00000000dead';
      const service = h.container.resolve('projectsService') as ProjectService;
      const deps = (
        service as unknown as {
          deps: {
            organizations: { findByIds: (ids: readonly string[]) => Promise<unknown[]> };
            access: { orgInScope: (id: string) => Promise<boolean> };
          };
        }
      ).deps;
      const { findByIds } = deps.organizations;
      const { orgInScope } = deps.access;
      deps.organizations.findByIds = async (ids) => ids.map((id) => ({ id }));
      deps.access.orgInScope = async () => true;
      const rowsBefore = (await auditRows(project.id)).length;
      let response;
      try {
        response = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
          payload: { organizationIds: [orgB, ghost], configurationVersion: project.configurationVersion },
        });
      } finally {
        deps.organizations.findByIds = findByIds;
        deps.access.orgInScope = orgInScope;
      }
      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
      const after = await getProject(h, project.id);
      expect(after.organizations.map((o) => o.id)).toEqual([orgA]);
      expect(after.configurationVersion).toBe(project.configurationVersion);
      expect(await auditRows(project.id)).toHaveLength(rowsBefore);
    }));

  it('PUT /organizations still names each Organization added and removed, in one write', async () =>
    withTasksOff(async () => {
      const project = await fresh('organizations trail');
      const rowsBefore = (await auditRows(project.id)).length;
      const response = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
        payload: { organizationIds: [orgB], configurationVersion: project.configurationVersion },
      });
      expect(response.statusCode, response.body).toBe(200);
      const rows = await auditRows(project.id);
      const added = rows.slice(0, rows.length - rowsBefore);
      expect(added.map((row) => row.action).sort()).toEqual([
        'projects.project.organization_add',
        'projects.project.organization_remove',
      ]);
      expect((await getProject(h, project.id)).configurationVersion).toBe(project.configurationVersion + 1);
    }));
});
