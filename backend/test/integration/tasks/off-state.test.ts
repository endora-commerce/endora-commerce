import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type AssetReferenceRegistryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { servedActions } from '../../contract/projects/palette-actions-shared.js';
import {
  createCrmOpportunity,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrder,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  createTasksRemindersJob,
  runTasksRemindersJob,
  type TaskSweepPass,
  type TasksRemindersJob,
} from '../../../../packages/modules/tasks/src/backend/workers/tasks-reminders-worker.js';

const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];

/**
 * Every admin route the module serves, read off the OpenAPI baseline — which
 * `test/contract/openapi.test.ts` holds to the served routes — so a route a
 * later change adds is probed here without anybody remembering to list it
 * (`specs/165-task-management/` T090). Path parameters become ids and codes
 * that name nothing; a write carries an empty body its schema refuses, so the
 * "on" phases write nothing.
 */
function baselineProbes(cookies: Record<string, string>): Array<{
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  cookies: Record<string, string>;
  payload?: unknown;
}> {
  const baseline = JSON.parse(
    readFileSync(new URL('../../fixtures/openapi-baseline.json', import.meta.url), 'utf8'),
  ) as { paths: Record<string, Record<string, unknown>> };
  const NOTHING = '00000000-0000-4000-8000-0000000071a5';
  return Object.entries(baseline.paths)
    .filter(([path]) => path === '/api/v1/admin/tasks' || path.startsWith('/api/v1/admin/tasks/'))
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => {
        const verb = method.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
        const url = path.replace(/\{code\}/g, 'nowhere').replace(/\{[A-Za-z]+\}/g, NOTHING);
        return verb === 'GET' || verb === 'DELETE' ? { method: verb, url, cookies } : { method: verb, url, cookies, payload: {} };
      }),
    );
}

/**
 * `tasks` off-state — Constitution XVII item 6
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
 * `tasks.enabled` *is* the activation control — the one setting that must stay
 * writable while the module is off. Since 165 the module owns ordinary
 * settings too (`tasks.time_zone`, `tasks.board_card_fields`), so one of them
 * is the `settingWrite` probe.
 *
 * Feature 165 T090 adds the rest of item 6 for what it built: the scheduled
 * tick asks nothing while off, a file a Task uses stays protected, the `task`
 * custom-field type is hidden, and the Opportunity, Order and Quote Request
 * detail APIs answer exactly as they did — each on both axes.
 */
describe('tasks off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const ID = '00000000-0000-4000-8000-0000000071a5';

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('positive control: the Tasks list answers while the module is on', async () => {
    const response = await h.app.inject({ method: 'GET', url: API, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('is absent from every surface while off, and restored after', async () => {
    // Each probe names a Task that does not exist, or sends a body its schema
    // refuses, so the "on" phases write nothing: what is measured is only
    // whether the route claims the module is absent.
    const derived = baselineProbes(admin);
    // Every story's routes, so a baseline that lost the module's paths fails
    // here rather than probing nothing: the 163 core, the workflow (US2), the
    // board and views (US3), comments (US4), relations (US5), links (US6),
    // reminders and the digest (US7), publishing (US8), tags and priorities
    // (US9), the settings.
    const urls = derived.map((probe) => `${probe.method} ${probe.url.replace(API, '')}`);
    for (const expected of [
      'GET ',
      'GET /count',
      'POST ',
      `DELETE /${ID}`,
      'GET /workflow',
      'PUT /transitions',
      'GET /board',
      'PUT /board/card-fields',
      'GET /list-views',
      `POST /${ID}/comments`,
      `PUT /${ID}/relations/${ID}`,
      `POST /${ID}/links`,
      `POST /${ID}/reminders`,
      'PUT /me/digest',
      `POST /${ID}/publish`,
      'POST /tags',
      'DELETE /priorities/nowhere',
      'PUT /settings/time-zone',
      `POST /${ID}/attachments/upload`,
    ]) {
      expect(urls).toContain(expected);
    }
    await expectModuleAbsent(h, 'tasks', {
      // `DELETE /me/digest` is the one probe that succeeds with an empty 204
      // once restored (turning off a digest nobody had is not an error), and
      // the harness reads every restored answer as JSON. Its siblings `GET` and
      // `PUT /me/digest` sit behind the same registration gate.
      routes: derived.filter((probe) => !(probe.method === 'DELETE' && probe.url === `${API}/me/digest`)),
      // An ordinary setting of the module's (165 US7): not writable while off.
      settingWrite: { code: 'tasks.time_zone', value: 'Europe/Warsaw', cookies: admin },
      adminPresence: { cookies: admin },
    });
  });

  /**
   * User Story 11 — the palette actions (165 adds the workflow screen's) and the `tasks.task` global-search
   * type, measured present, absent on both axes, and back. The other surfaces
   * the final sweep (T135) names for this module are proved beside their
   * subject: the Tasks tab, Stage Tasks, gates and the `@@` Task group in
   * Projects (`integration/projects/{completion-gate,stage-tasks,…}.test.ts`)
   * and in CRM (`integration/crm/references-documents.test.ts`).
   */
  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'offers its palette actions and its search type while on, neither while %s, and both after',
    async (axis) => {
      const ACTIONS = ['new-task', 'open-my-tasks', 'open-task-general-settings', 'open-task-priorities', 'open-task-tags', 'open-task-workflow', 'open-tasks'];
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
      expect(Object.keys(await servedActions(h, 'tasks'))).toEqual(ACTIONS);
      expect(await capability()).toContain('tasks.task');

      await withModuleOff('tasks', axis, async () => {
        expect(await servedActions(h, 'tasks')).toEqual({});
        expect(await capability()).not.toContain('tasks.task');
      });

      expect(Object.keys(await servedActions(h, 'tasks'))).toEqual(ACTIONS);
      expect(await capability()).toContain('tasks.task');
    },
  );

  describe('what 165 built, on both axes (T090)', () => {
    const assets: string[] = [];
    const tasks: string[] = [];
    let task: { id: string };
    let opportunity: { id: string };
    let order: { id: string };
    let quote: { id: string };

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      opportunity = await createCrmOpportunity(h, { title: 'Off-state deal', organizationId: TEST_ORGANIZATION_ID });
      order = await seedCrmOrder(h.em());
      quote = await submitCrmQuoteRequest(h);
      const created = await h.app.inject({ method: 'POST', url: API, cookies: admin, payload: { title: 'Off-state Task' } });
      expect(created.statusCode, created.body).toBe(201);
      task = (created.json() as { data: { id: string } }).data;
      tasks.push(task.id);
      // A Task linked to all three, so their detail APIs have something of Tasks' to leak.
      for (const [kind, id] of [
        ['opportunity', opportunity.id],
        ['order', order.id],
        ['quote_request', quote.id],
      ] as const) {
        const linked = await h.app.inject({
          method: 'POST',
          url: `${API}/${task.id}/links`,
          cookies: admin,
          payload: { kind, id },
        });
        expect(linked.statusCode, linked.body).toBe(201);
      }
    });

    afterAll(async () => {
      if (tasks.length > 0) {
        await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${tasks.join(',')}}`]);
      }
      await removeCrmAssets(h.em(), assets);
    });

    it.each(AXES)('the scheduled tick asks no probe while %s, and all four once back', async (axis) => {
      const composed = h.container.resolve('tasksRemindersJob') as TasksRemindersJob;
      const asked: string[] = [];
      const counted = (pass: TaskSweepPass): TaskSweepPass => ({
        scopeReason: pass.scopeReason,
        hasWork: async () => {
          asked.push(pass.scopeReason);
          return false;
        },
        run: async () => undefined,
      });
      const tick = () =>
        runWithoutTenantContext(() =>
          runTasksRemindersJob(
            createTasksRemindersJob({
              ...composed.deps,
              reminders: counted(composed.deps.reminders),
              digest: counted(composed.deps.digest),
              maintenance: counted(composed.deps.maintenance),
              rederive: counted(composed.deps.rederive),
            }),
            new Date(),
          ),
        );
      await withModuleOff('tasks', axis, tick);
      expect(asked).toEqual([]);
      await tick();
      expect(asked).toHaveLength(4);
    });

    it.each(AXES)('a file a Task uses stays protected from deletion while %s, and hidden from a restricted reader until Tasks is back', async (axis) => {
      const file = await seedCrmAsset(h.em());
      assets.push(file.id);
      const attached = await h.app.inject({
        method: 'POST',
        url: `${API}/${task.id}/attachments`,
        cookies: admin,
        payload: { assetId: file.id },
      });
      expect(attached.statusCode, attached.body).toBe(201);
      const registry = h.container.resolve<AssetReferenceRegistryPort>('assetReferenceRegistry');
      // `specs/166-asset-reference-visibility/` US5 (FR-009, FR-010): a reader of
      // Tasks who is not the Platform administrator sees the file through the
      // Task while Tasks is on, not while it is off; the Platform administrator
      // sees it throughout.
      const reader = await seedCrmAdmin(h.em(), `off-${axis}`, ['tasks:read', 'assets.read', 'assets.write']);
      const lists = async (cookies: Record<string, string>): Promise<boolean> => {
        const response = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/assets?q=${encodeURIComponent(file.filename)}`,
          cookies,
        });
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as { data: Array<{ id: string }> }).data.some((row) => row.id === file.id);
      };
      try {
        expect(await lists(reader.cookies), 'listed for the reader while Tasks is on').toBe(true);
        await withModuleOff('tasks', axis, async () => {
          const refused = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${file.id}`, cookies: admin });
          expect(refused.statusCode, refused.body).toBe(409);
          expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
          expect(await lists(reader.cookies), 'hidden from the reader while Tasks is off').toBe(false);
          expect(await lists(admin), 'listed for the Platform administrator while Tasks is off').toBe(true);
        });
        expect(await lists(reader.cookies), 'listed for the reader once Tasks is back').toBe(true);
      } finally {
        reader.undo();
      }
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `${API}/${task.id}/attachments/${(attached.json() as { data: { id: string } }).data.id}`,
        cookies: admin,
      });
      expect(removed.statusCode, removed.body).toBe(204);
      expect(await registry.findReferences(file.id)).toEqual([]);
    });

    it.each(AXES)('the task custom-field type is hidden while %s, and back after', async (axis) => {
      const types = async (): Promise<string[]> => {
        const response = await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', cookies: admin });
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as { data: Array<{ entityType: string }> }).data.map((row) => row.entityType);
      };
      expect(await types()).toContain('task');
      await withModuleOff('tasks', axis, async () => {
        expect(await types()).not.toContain('task');
      });
      expect(await types()).toContain('task');
    });

    it.each(AXES)('the Opportunity, Order and Quote Request detail APIs answer as they did while %s', async (axis) => {
      const details = [
        `/api/v1/admin/crm/opportunities/${opportunity.id}`,
        `/api/v1/admin/orders/${order.id}`,
        `/api/v1/admin/quote-requests/${quote.id}`,
      ];
      const read = async (): Promise<unknown[]> => {
        const bodies: unknown[] = [];
        for (const url of details) {
          const response = await h.app.inject({ method: 'GET', url, cookies: admin });
          expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
          bodies.push(response.json());
        }
        return bodies;
      };
      const before = await read();
      await withModuleOff('tasks', axis, async () => {
        expect(await read()).toEqual(before);
      });
      expect(await read()).toEqual(before);
    });
  });
});
