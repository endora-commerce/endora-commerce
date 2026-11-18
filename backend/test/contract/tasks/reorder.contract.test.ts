import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskPriorityListResponseSchema, TaskWorkflowResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { restoreDefaultTaskWorkflow } from '../../helpers/task-workflow.js';

/**
 * Issue #1560 — the batch reorder of the Task statuses and priorities:
 * `PUT /tasks/statuses/order` and `PUT /tasks/priorities/order`, each the
 * whole list in its new order, one audited Command, answering the list as the
 * matching `GET` does. A row left out or named twice is 409 `ORDER_STALE`; a
 * code that is not configured is 404 `NOT_FOUND`; either way nothing moves.
 * Only `tasks:configure` reorders.
 *
 * Both lists are platform-wide configuration: the statuses are restored to the
 * seeded workflow before and after, the priorities' weights to what they were.
 */
describe('tasks (contract) — batch reorder (#1560)', () => {
  let h: BackendServerHandle;
  let writer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  let priorityWeights: Array<{ code: string; weight: number }> = [];

  function call(method: 'GET' | 'PUT', path: string, payload?: unknown, cookies: { b2b_session: string } = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  const statusCodes = async (): Promise<string[]> =>
    TaskWorkflowResponseSchema.parse((await call('GET', '/workflow')).json()).data.statuses.map((s) => s.code);
  const priorityCodes = async (): Promise<string[]> =>
    TaskPriorityListResponseSchema.parse((await call('GET', '/priorities')).json()).data.map((p) => p.code);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultTaskWorkflow(h.em());
    writer = await seedCrmAdmin(h.em(), 'reorder-writer', ['tasks:read', 'tasks:write']);
    priorityWeights = (await h.em().getConnection().execute(`select "code", "weight" from "task_priorities"`)) as Array<{
      code: string;
      weight: number;
    }>;
  });

  afterAll(async () => {
    writer?.undo();
    const connection = h.em().getConnection();
    for (const row of priorityWeights) {
      await connection.execute(`update "task_priorities" set "weight" = ? where "code" = ?`, [row.weight, row.code]);
    }
    await restoreDefaultTaskWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('PUT /tasks/statuses/order', () => {
    const DEFAULT_ORDER = ['todo', 'in_progress', 'done', 'cancelled'];

    it('re-orders every status in one Command and answers 200 with the workflow', async () => {
      const reordered = ['in_progress', 'todo', 'cancelled', 'done'];
      const response = await call('PUT', '/statuses/order', { orderedCodes: reordered });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = TaskWorkflowResponseSchema.parse(response.json());
      expect(data.statuses.map((status) => status.code)).toEqual(reordered);
      expect(await statusCodes()).toEqual(reordered);

      const entries = await h.auditLogService.query({ action: 'tasks.status.reorder' });
      const latest = entries.find((entry) => JSON.stringify(entry.stateAfter) === JSON.stringify({ order: reordered }));
      expect(latest, JSON.stringify(entries.map((entry) => entry.stateAfter))).toBeDefined();
      expect(latest?.objectType).toBe('task_status');
      expect(latest?.stateBefore).toEqual({ order: DEFAULT_ORDER });

      const restored = await call('PUT', '/statuses/order', { orderedCodes: DEFAULT_ORDER });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(await statusCodes()).toEqual(DEFAULT_ORDER);
    });

    it.each([
      ['a status left out', ['todo', 'in_progress', 'done']],
      ['a status named twice', ['todo', 'in_progress', 'done', 'cancelled', 'todo']],
    ])('refuses %s — 409 ORDER_STALE, and moves nothing', async (_case, orderedCodes) => {
      const response = await call('PUT', '/statuses/order', { orderedCodes });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('ORDER_STALE');
      expect(await statusCodes()).toEqual(DEFAULT_ORDER);
    });

    it('refuses a code that is not configured — 404 NOT_FOUND', async () => {
      const response = await call('PUT', '/statuses/order', { orderedCodes: ['nowhere', ...DEFAULT_ORDER] });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
      expect(await statusCodes()).toEqual(DEFAULT_ORDER);
    });

    it('is tasks:configure — 403 to a writer', async () => {
      const response = await call('PUT', '/statuses/order', { orderedCodes: [...DEFAULT_ORDER].reverse() }, writer.cookies);
      expect(response.statusCode, response.body).toBe(403);
      expect(await statusCodes()).toEqual(DEFAULT_ORDER);
    });
  });

  describe('PUT /tasks/priorities/order', () => {
    it('re-orders every priority in one Command and answers 200 with the list', async () => {
      const before = await priorityCodes();
      const reordered = [...before].reverse();
      const response = await call('PUT', '/priorities/order', { orderedCodes: reordered });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = TaskPriorityListResponseSchema.parse(response.json());
      expect(data.map((priority) => priority.code)).toEqual(reordered);
      expect(await priorityCodes()).toEqual(reordered);

      const entries = await h.auditLogService.query({ action: 'tasks.priority.reorder' });
      const latest = entries.find((entry) => JSON.stringify(entry.stateAfter) === JSON.stringify({ order: reordered }));
      expect(latest, JSON.stringify(entries.map((entry) => entry.stateAfter))).toBeDefined();
      expect(latest?.objectType).toBe('task_priority');
      expect(latest?.stateBefore).toEqual({ order: before });

      expect((await call('PUT', '/priorities/order', { orderedCodes: before })).statusCode).toBe(200);
      expect(await priorityCodes()).toEqual(before);
    });

    it('refuses a priority left out — 409 ORDER_STALE; an unknown code — 404', async () => {
      const before = await priorityCodes();
      const stale = await call('PUT', '/priorities/order', { orderedCodes: before.slice(1) });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json().error.code).toBe('ORDER_STALE');
      const unknown = await call('PUT', '/priorities/order', { orderedCodes: [...before, 'nowhere'] });
      expect(unknown.statusCode, unknown.body).toBe(404);
      expect(unknown.json().error.code).toBe('NOT_FOUND');
      expect(await priorityCodes()).toEqual(before);
    });

    it('is tasks:configure — 403 to a writer', async () => {
      const before = await priorityCodes();
      const response = await call('PUT', '/priorities/order', { orderedCodes: [...before].reverse() }, writer.cookies);
      expect(response.statusCode, response.body).toBe(403);
      expect(await priorityCodes()).toEqual(before);
    });
  });
});
