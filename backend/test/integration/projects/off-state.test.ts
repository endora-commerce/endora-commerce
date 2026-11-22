import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProjectReadPort } from '@endora-commerce/contracts';
import { enterSystemScope, ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { servedActions } from '../../contract/projects/palette-actions-shared.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { createProject, deleteProjects, patchStage, stageNamed } from './helpers.js';

/**
 * `projects` off-state — Constitution XVII item 6
 * (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`).
 *
 * Every route of the module is registered through `ctx.routes`, so the gate is
 * applied at the registration seam; this file measures it on both axes —
 * deactivated while platform-available, and platform-unavailable — with full
 * restoration after each. Each story that adds a route adds it below.
 *
 * **Storefront absence** is answered here rather than probed: the module has no
 * storefront route and contributes no storefront element (FR-043).
 *
 * The configuration half is driven over `projects.visibility`, an ordinary
 * module setting, because the activation control itself is the one setting
 * that must stay writable while the module is off.
 */
describe('projects off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/projects';
  const ID = '00000000-0000-4000-8000-0000000071a6';

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('positive control: the Projects list answers while the module is on', async () => {
    const response = await h.app.inject({ method: 'GET', url: API, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('positive control: the visibility setting is writable while the module is on', async () => {
    const response = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.visibility/value',
      cookies: admin,
      payload: { scope: 'all', value: 'members' },
    });
    expect(response.statusCode, response.body).toBeLessThan(400);
  });

  it('is absent from every surface while off, and restored after', async () => {
    // User Story 1's routes. Each write probe names a Project that does not
    // exist, or sends a body its schema refuses, so the "on" phases write
    // nothing: what is measured is only whether the route claims the module
    // is absent.
    const STAGE = '00000000-0000-4000-8000-0000000071a7';
    const write = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload: unknown = {}) => ({
      method,
      url,
      cookies: admin,
      payload,
    });
    await expectModuleAbsent(h, 'projects', {
      routes: [
        { url: API, cookies: admin },
        { url: `${API}/${ID}`, cookies: admin },
        { url: `${API}/${ID}/stage-history`, cookies: admin },
        // Issue #1734 — the Projects list's saved views; the write probes send a
        // body the schema refuses or name a view that does not exist.
        { url: `${API}/list-views`, cookies: admin },
        write('POST', `${API}/list-views`, { name: '' }),
        write('PATCH', `${API}/list-views/${ID}`, { shared: true }),
        write('DELETE', `${API}/list-views/${ID}`, undefined),
        { url: `${API}/roles`, cookies: admin },
        { url: `${API}/loss-reasons`, cookies: admin },
        write('POST', API),
        write('PATCH', `${API}/${ID}`, { title: 'x', version: 1 }),
        write('DELETE', `${API}/${ID}`, undefined),
        write('PUT', `${API}/${ID}/organizations`, { organizationIds: [] }),
        write('PUT', `${API}/${ID}/members`, { members: [] }),
        write('POST', `${API}/${ID}/stages`, { name: 'x', color: '#000000' }),
        write('PATCH', `${API}/${ID}/stages/${STAGE}`, { name: 'x' }),
        write('DELETE', `${API}/${ID}/stages/${STAGE}`, undefined),
        write('PUT', `${API}/${ID}/stages/order`, { stageIds: [STAGE] }),
        write('PUT', `${API}/${ID}/moves`, { moves: [] }),
        write('POST', `${API}/${ID}/move`, { toStageId: STAGE, version: 1 }),
        write('POST', `${API}/${ID}/close`, { outcome: 'completed', version: 1 }),
        write('POST', `${API}/${ID}/reopen`, { version: 1 }),
        // User Story 2's routes.
        { url: `${API}/${ID}/tasks`, cookies: admin },
        write('PUT', `${API}/${ID}/stages/${STAGE}/tasks`, { tasks: [] }),
        write('POST', `${API}/${ID}/stages/${STAGE}/materialize-tasks`),
        // User Story 3's routes — Templates; the write probes name a Template
        // that does not exist or send a body the schema refuses.
        { url: `${API}/templates`, cookies: admin },
        { url: `${API}/templates/${ID}`, cookies: admin },
        write('POST', `${API}/templates`, { name: '' }),
        write('PUT', `${API}/templates/${ID}`, { name: '' }),
        write('POST', `${API}/templates/${ID}/duplicate`),
        write('POST', `${API}/templates/${ID}/archive`),
        write('POST', `${API}/templates/${ID}/restore`),
        // User Story 4's writes — Project Roles and loss reasons. Each names an
        // entry that does not exist, or sends a body the schema refuses.
        ...(['roles', 'loss-reasons'] as const).flatMap((dictionary) => [
          write('POST', `${API}/${dictionary}`, { defaultName: '' }),
          write('PATCH', `${API}/${dictionary}/${ID}`, { defaultName: 'x' }),
          write('POST', `${API}/${dictionary}/${ID}/archive`),
          write('POST', `${API}/${dictionary}/${ID}/restore`),
          write('DELETE', `${API}/${dictionary}/${ID}`, undefined),
        ]),
        // User Story 5's routes — the pickers' lookups and the visibility setting.
        { url: `${API}/lookups/organizations`, cookies: admin },
        { url: `${API}/lookups/admin-users`, cookies: admin },
        { url: `${API}/visibility-setting`, cookies: admin },
        // User Story 6's routes — linked records and the record panel. The
        // write probes name a Project that does not exist.
        { url: `${API}/${ID}/links`, cookies: admin },
        write('POST', `${API}/${ID}/links`, { kind: 'order', recordId: STAGE }),
        write('DELETE', `${API}/${ID}/links/${STAGE}`, undefined),
        { url: `${API}/records/order/${ID}/project`, cookies: admin },
        { url: `${API}/records/task/${ID}/project`, cookies: admin },
        // User Story 7's routes — notes, messages, attachments, history and the
        // reference lookups. The write probes name a Project that does not
        // exist, or send a body the schema refuses (the upload: no multipart).
        { url: `${API}/${ID}/comments?kind=note`, cookies: admin },
        write('POST', `${API}/${ID}/comments`, { kind: 'note', body: 'x' }),
        write('PATCH', `${API}/${ID}/comments/${STAGE}`, { body: 'x' }),
        write('DELETE', `${API}/${ID}/comments/${STAGE}`, undefined),
        write('POST', `${API}/${ID}/messages/read`, { throughMessageId: STAGE }),
        { url: `${API}/${ID}/attachments`, cookies: admin },
        write('POST', `${API}/${ID}/attachments`, { assetId: STAGE }),
        write('POST', `${API}/${ID}/attachments/upload`),
        write('DELETE', `${API}/${ID}/attachments/${STAGE}`, undefined),
        { url: `${API}/${ID}/history`, cookies: admin },
        { url: `${API}/lookups/mentionable`, cookies: admin },
        { url: `${API}/lookups/documents`, cookies: admin },
        // User Story 9's route — the custom fields the list filters on.
        { url: `${API}/custom-field-filters`, cookies: admin },
        // User Story 10's routes — the seven analytics figures.
        ...['summary', 'durations', 'time-in-stage', 'losses', 'value', 'top-open', 'managers'].map((figure) => ({
          url: `${API}/analytics/${figure}?from=2026-01-01&to=2026-01-31`,
          cookies: admin,
        })),
      ],
      adminPresence: { cookies: admin },
      settingWrite: { code: 'projects.visibility', value: 'everyone', cookies: admin },
    });
  });

  /**
   * User Story 11 — what the module contributes to the platform beyond its
   * routes: six palette actions, the `projects.project` global-search type and
   * `projectReadPort`. Each is measured present, absent on both axes, and back.
   *
   * The rest of the final sweep (T135) is proved where its subject lives, each
   * with its own positive control: the four record panels and the Organization
   * panel withdraw in the admin (`admin/test/modules/projects/ProjectPanel.test.tsx`,
   * `OrganizationProjects.test.tsx`) and their read answers 503 above
   * (`/records/:kind/:id/project`); the *Project* custom-field type in
   * `custom-fields.test.ts`; the `project` Task context — a Project's Tasks
   * leave the Tasks module — in `task-context.test.ts` and `global-search.test.ts`;
   * the asset-deletion scanner, booted while off, in `attachments.test.ts`; and
   * the alert sweep below.
   */
  describe('palette, global search and projectReadPort (User Story 11)', () => {
    // Six since issue #516 added the role and loss-reason dictionaries.
    const ACTIONS = [
      'new-project',
      'open-project-analytics',
      'open-project-loss-reasons',
      'open-project-roles',
      'open-project-templates',
      'open-projects',
    ];
    const capability = async (): Promise<string[]> => {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/global-search/capability?language=en',
        cookies: admin,
      });
      expect(response.statusCode, response.body).toBe(200);
      return (response.json() as { data: { entityTypes: Array<{ entityType: string }> } }).data.entityTypes.map(
        (entry) => entry.entityType,
      );
    };
    const readPortAnswers = async (): Promise<boolean> => {
      try {
        await enterSystemScope('test: projects read port off-state', async () =>
          h.container.resolve<ProjectReadPort>('projectReadPort').findById(ID),
        );
        return true;
      } catch (error) {
        if (error instanceof ModuleDisabledError) return false;
        throw error;
      }
    };

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'are offered while on, withdrawn while %s, and back after',
      async (axis) => {
        expect(Object.keys(await servedActions(h, 'projects'))).toEqual(ACTIONS);
        expect(await capability()).toContain('projects.project');
        expect(await readPortAnswers()).toBe(true);

        await withModuleOff('projects', axis, async () => {
          expect(await servedActions(h, 'projects')).toEqual({});
          expect(await capability()).not.toContain('projects.project');
          expect(await readPortAnswers()).toBe(false);
        });

        expect(Object.keys(await servedActions(h, 'projects'))).toEqual(ACTIONS);
        expect(await capability()).toContain('projects.project');
        expect(await readPortAnswers()).toBe(true);
      },
    );
  });

  describe('the deadline-alert sweep’s tick (User Story 8)', () => {
    // The consumer of `projects-stage-alerts` is attached through `ctx.worker`,
    // which is what stops it with the module — and which this harness cannot
    // show: it composes with no queue connection, so no consumer is built
    // (`check:subscribe-seam` holds the `Worker` to that seam statically, and
    // `stage-alert-worker.test.ts` the function that builds it).
    //
    // What is driven here is the work's own gate: the function the consumer
    // runs on every tick, exactly as the module composed it, which decides the
    // module's presence before it reads a row. The pass reads its own clock, so
    // the clock is set to 08:30 in Warsaw on the alert's due day.
    const created: string[] = [];
    const tick = () =>
      enterSystemScope('test: projects stage alert tick', () =>
        (h.container.resolve('projectsStageAlertTick') as () => Promise<void>)(),
      );
    const alertsAbout = (projectId: string) =>
      h.em().count(AdminNotification, { subjectId: projectId, kind: 'projects.project.stage_deadline' }, { filters: false });
    const deliveriesOf = async (stageId: string) =>
      (
        (await h
          .em()
          .getConnection()
          .execute(`select 1 from "project_stage_alert_deliveries" where "stage_id" = ?`, [stageId])) as unknown[]
      ).length;
    /** A Project whose Stage alert is due on `dueOn`, the harness administrator its Member. */
    const dueOn = async (dueOn: string) => {
      const project = await createProject(h, {
        title: `off-state alert ${dueOn}`,
        members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [] }],
      });
      created.push(project.id);
      const design = stageNamed(project, 'Design');
      const [year, month, day] = dueOn.split('-').map(Number) as [number, number, number];
      await patchStage(h, project.id, design, {
        alertOffsetsDays: [1],
        deadlineOn: new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10),
      });
      return { projectId: project.id, design };
    };
    const at = (date: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${date}T07:30:00.000Z`));
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    afterAll(async () => {
      await deleteProjects(h, created);
    });

    it('delivers a due alert while on — the positive control', async () => {
      const { projectId, design } = await dueOn('2033-01-10');
      at('2033-01-10');
      await tick();
      expect(await alertsAbout(projectId)).toBe(1);
      expect(await deliveriesOf(design)).toBe(1);
    });

    it.each<[OffStateAxis, string]>([
      ['deactivated', '2033-01-12'],
      ['platform-unavailable', '2033-01-14'],
    ])('claims nothing and tells nobody while %s, and delivers once after the module is back', async (axis, day) => {
      const { projectId, design } = await dueOn(day);
      at(day);
      await withModuleOff('projects', axis, async () => {
        await tick();
        await tick();
        expect(await alertsAbout(projectId)).toBe(0);
        // Nothing claimed: the alert is still due when the module comes back.
        expect(await deliveriesOf(design)).toBe(0);
      });

      await tick();
      await tick();
      expect(await alertsAbout(projectId)).toBe(1);
      expect(await deliveriesOf(design)).toBe(1);
    });
  });
});
