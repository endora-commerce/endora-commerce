import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  TaskDetailResponseSchema,
  type CustomFieldValuePort,
  type TaskCommandPort,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
  type TaskDetail,
  type TaskWritePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin, seedCrmOrder } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `specs/186-aggregate-ports/` T093 (issue #1829, US10; research R-23) —
 * `taskCommandPort` runs the Commands the admin route for the same operation
 * runs, through the route's own service method. Each case performs the
 * operation twice, once through the route and once through the port under the
 * same administrator, on two Tasks in the same state, and holds what each
 * wrote to the other (`expectPortParity`): the audit entries and, through a
 * probe, the bell a colleague is rung with. `createMany` and `deleteInContext`
 * have no route: they are held to the deprecated `taskWritePort`, which now
 * delegates.
 *
 * Then the port's own additions: `source` recorded beside the actor; a
 * malformed `source` and an unclaimed extension refused with nothing written;
 * the status move's optional `from` and its refusals; the seven methods that
 * need an administrator refused under the bare system scope; another
 * administrator's private Task read-only to it; and the port failing closed
 * while `tasks` is off.
 */

const API = '/api/v1/admin/tasks';
const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
const FIELD = 'cmd_port_region';
const ADMIN = { b2b_session: 'stub-admin-session' };
const PROBE_CONTEXT = 'command_port_probe';

describe('taskCommandPort — the admin routes’ Commands (#1829)', () => {
  let h: BackendServerHandle;
  let port: TaskCommandPort;
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let definitionId = '';
  let orderId = '';
  let tagId = '';
  const created: string[] = [];
  const probeContexts = new Set<string>();

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: task command port', fn);
  const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScope('test: task command port, no administrator', fn);

  /** What one path wrote for a Task: its audit entries, and the probe's answer. */
  function observe<T>(
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'task', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  async function route(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown, status = 200) {
    const response = await h.app.inject({
      method,
      url: `${API}${path}`,
      cookies: ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    expect(response.statusCode, response.body).toBe(status);
    return response.body ? (response.json() as { data: Record<string, unknown> }) : null;
  }

  async function createTask(body: Record<string, unknown> = {}): Promise<TaskDetail> {
    const response = await h.app.inject({
      method: 'POST',
      url: API,
      cookies: ADMIN,
      payload: { title: 'Port parity', ...body },
    });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  /** Two Tasks in the same state. */
  async function pair(body: Record<string, unknown> = {}): Promise<[TaskDetail, TaskDetail]> {
    return [await createTask(body), await createTask(body)];
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details: unknown }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string; details?: unknown };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error), details: e.details };
    }
    throw new Error('expected a refusal');
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'task', objectId }, { orderBy: { actedAt: 'asc' } });

  /** How many bells the colleague has about one Task — the side effect a write rings. */
  const bells = async (taskId: string): Promise<number> =>
    (
      await h
        .em()
        .fork()
        .find(AdminNotification, { subjectId: taskId, targetAdminUserId: colleague.adminUserId }, { filters: false })
    ).length;

  const tasksTitled = async (title: string): Promise<number> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "tasks" where "title" = ?`, [title])) as Array<{ n: number }>;
    return Number(rows[0]!.n);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<TaskCommandPort>('taskCommandPort');
    colleague = await seedCrmAdmin(h.em(), 'task-port-colleague', ['tasks:read', 'tasks:write']);
    orderId = (await seedCrmOrder(h.em())).id;
    const response = await h.app.inject({
      method: 'POST',
      url: `${CUSTOM_FIELDS_API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType: 'task',
        key: FIELD,
        label: {},
        labelDefault: FIELD,
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    definitionId = (response.json() as { data: { id: string } }).data.id;
    const probe: TaskContextDescriptor = {
      contextType: PROBE_CONTEXT,
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [...probeContexts],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => probeContexts.has(id))),
      canSeeAs: async (_adminUserId, id) => probeContexts.has(id),
      canChangeTasks: async () => true,
      describe: async () => new Map(),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    if (created.length > 0) {
      await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await connection.execute(`delete from "tasks" where "context_type" = ?`, [PROBE_CONTEXT]);
    if (definitionId) {
      await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${definitionId}`, cookies: ADMIN });
    }
    if (tagId) await h.app.inject({ method: 'DELETE', url: `${API}/tags/${tagId}`, cookies: ADMIN });
    colleague.undo();
    await teardownBackendServer(h);
  });

  it('create — tasks.task.create, as the admin create, the assignee told once', async () => {
    const body = () => ({ title: 'Created through the port', description: 'Both floors', assigneeIds: [colleague.adminUserId] });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          (res) => {
            const id = res!.data['id'] as string;
            created.push(id);
            return id;
          },
          () => route('POST', '', body(), 201),
          (res) => bells(res!.data['id'] as string),
        ),
      viaPort: () =>
        observe(
          (record) => {
            created.push(record.id);
            return record.id;
          },
          () => asAdmin(() => port.create(body())),
          (record) => bells(record.id),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.create']);
    expect(viaPort.audit[0]!.actorAdminUserId).toBe(TEST_ADMIN_ID);
    expect(viaPort.sideEffects).toBe(1);
  });

  it('update — tasks.task.update alone, the fields the PATCH writes in it', async () => {
    const [a, b] = await pair();
    const patch = { title: 'Renamed', description: 'Both floors, @nobody', dueOn: '2027-01-05', startOn: '2027-01-02' };
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, patch)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.update(b.id, patch))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.update']);
    const record = await asAdmin(() => port.update(b.id, { title: 'Renamed' }));
    expect(record).toMatchObject({ id: b.id, title: 'Renamed', dueOn: '2027-01-05' });

    // What another Command of the PATCH writes is not `update`'s (R-23.1, changed).
    const count = (await entries(b.id)).length;
    for (const extra of [{ assigneeIds: [colleague.adminUserId] }, { priorityCode: 'high' }, { private: true }]) {
      expect(
        await refusal(asAdmin(() => port.update(b.id, { title: 'Nope', ...extra } as unknown as Parameters<TaskCommandPort['update']>[1]))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
    }
    expect(await entries(b.id)).toHaveLength(count);
  });

  it('setAssignees — tasks.task.assignees_change alone, the new assignee told', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { assigneeIds: [colleague.adminUserId] }), () => bells(a.id)),
      viaPort: () =>
        observe(b.id, () => asAdmin(() => port.setAssignees(b.id, { set: [colleague.adminUserId] })), () => bells(b.id)),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.assignees_change']);
    expect(viaPort.sideEffects).toBe(1);
    const changed = await expectPortParity({
      viaRoute: () =>
        observe(a.id, () => route('PATCH', `/${a.id}`, { addAssigneeIds: [TEST_ADMIN_ID], removeAssigneeIds: [colleague.adminUserId] })),
      viaPort: () =>
        observe(b.id, () =>
          asAdmin(() => port.setAssignees(b.id, { add: [TEST_ADMIN_ID], remove: [colleague.adminUserId] })),
        ),
    });
    expect(changed.port.audit.map((e) => e.action)).toEqual(['tasks.task.assignees_change']);
    expect((await asAdmin(() => port.setAssignees(b.id, { add: [], remove: [] }))).assigneeIds).toEqual([TEST_ADMIN_ID]);
  });

  it('setPriority — tasks.task.priority_change alone', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { priorityCode: 'high' })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setPriority(b.id, { priorityCode: 'high' }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.priority_change']);
    expect(await refusal(asAdmin(() => port.setPriority(b.id, { priorityCode: 'no_such_priority' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.TASK_PRIORITY_UNKNOWN,
    });
  });

  it('setTags — tasks.task.tags_change alone', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/tags`,
      cookies: ADMIN,
      payload: { name: `Port tag ${randomUUID().slice(0, 8)}` },
    });
    expect(response.statusCode, response.body).toBe(201);
    tagId = (response.json() as { data: { id: string } }).data.id;
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { tagIds: [tagId] })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setTags(b.id, { tagIds: [tagId] }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.tags_change']);
  });

  it('setParent — tasks.task.parent_change alone', async () => {
    const [a, b] = await pair();
    const parent = await createTask({ title: 'Port parent' });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { parentTaskId: parent.id })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setParent(b.id, { parentTaskId: parent.id }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.parent_change']);
    expect(await refusal(asAdmin(() => port.setParent(parent.id, { parentTaskId: b.id })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.TASK_PARENT_CYCLE,
    });
    const detached = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { parentTaskId: null })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setParent(b.id, { parentTaskId: null }))),
    });
    expect(detached.port.audit.map((e) => e.action)).toEqual(['tasks.task.parent_change']);
  });

  it('setPrivate — tasks.task.privacy_change alone, against the Task as it stands', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { private: true })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setPrivate(b.id, { private: true }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.privacy_change']);
    expect((await asAdmin(() => port.setPrivate(b.id, { private: false }))).private).toBe(false);

    // Someone else assigned: clear the assignees first, as the ruling says.
    const [assigned] = await pair({ assigneeIds: [colleague.adminUserId] });
    const count = (await entries(assigned.id)).length;
    expect(await refusal(asAdmin(() => port.setPrivate(assigned.id, { private: true })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.TASK_PRIVATE_ASSIGNEE,
    });
    // Only the Creator says so: nobody behind the call is not the Creator.
    expect(await refusal(asSystem(() => port.setPrivate(assigned.id, { private: true })))).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(await entries(assigned.id)).toHaveLength(count);
  });

  it('setStatus — tasks.task.status_change through the workflow, from the status the port read', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `/${a.id}/status`, { from: 'todo', to: 'in_progress' })),
      viaPort: () => observe(b.id, () => asAdmin(() => port.setStatus(b.id, { to: 'in_progress' }))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.status_change']);
    const done = await asAdmin(() => port.setStatus(b.id, { to: 'done', from: 'in_progress' }));
    expect(done).toMatchObject({ status: 'done', statusCategory: 'done', closed: true });

    const count = (await entries(b.id)).length;
    expect(await refusal(asAdmin(() => port.setStatus(b.id, { to: 'todo', from: 'in_progress' })))).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.TASK_TRANSITION_CONFLICT,
    });
    // Not a status of the workflow — malformed or not, the route's refusal, never a schema's.
    for (const to of ['no_such_status', 'Not A Code!']) {
      expect(await refusal(asAdmin(() => port.setStatus(b.id, { to })))).toMatchObject({
        statusCode: 422,
        code: ERROR_CODES.TASK_STATUS_UNKNOWN,
      });
    }
    expect(await entries(b.id)).toHaveLength(count);
  });

  it('setCustomFieldValues — tasks.task.custom_fields_change, the Command PATCH runs for the values', async () => {
    const [a, b] = await pair();
    const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PATCH', `/${a.id}`, { customFieldValues: { [FIELD]: 'North' } })),
      viaPort: () =>
        observe(b.id, () =>
          asAdmin(() =>
            port.setCustomFieldValues(b.id, (current) => values.validateAndMerge('task', current, { [FIELD]: 'North' })),
          ),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.custom_fields_change']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ changedCustomFields: [FIELD] });

    // The record carries the bag (FR-015); a merge that changes nothing records nothing.
    const count = (await entries(b.id)).length;
    const record = await asAdmin(() => port.setCustomFieldValues(b.id, async (current) => ({ ...current })));
    expect(record.customFieldValues).toEqual({ [FIELD]: 'North' });
    expect(await entries(b.id)).toHaveLength(count);
    expect(
      await refusal(asAdmin(() => port.setCustomFieldValues(b.id, async () => 'nope' as unknown as Record<string, unknown>))),
    ).toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
    expect(await entries(b.id)).toHaveLength(count);
  });

  it('publish — tasks.task.publish, the assignee told as on the route', async () => {
    const [a, b] = await pair({ draft: true, assigneeIds: [colleague.adminUserId] });
    expect(await bells(a.id)).toBe(0);
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `/${a.id}/publish`), () => bells(a.id)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.publish(b.id)), () => bells(b.id)),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.publish']);
    expect(viaPort.sideEffects).toBe(1);
    expect(await refusal(asAdmin(() => port.publish(b.id)))).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.TASK_ALREADY_PUBLISHED,
    });
  });

  it('relate and unrelate — tasks.task.relate / .unrelate, recorded on both Tasks', async () => {
    const [a, other] = await pair();
    const [b, otherB] = await pair();
    const related = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('PUT', `/${a.id}/relations/${other.id}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.relate(b.id, otherB.id))),
    });
    expect(related.port.audit.map((e) => e.action)).toEqual(['tasks.task.relate']);
    expect((await entries(otherB.id)).map((e) => e.action)).toContain('tasks.task.relate');
    const unrelated = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `/${a.id}/relations/${other.id}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.unrelate(b.id, otherB.id))),
    });
    expect(unrelated.port.audit.map((e) => e.action)).toEqual(['tasks.task.unrelate']);
  });

  it('link and unlink — tasks.task.link / .unlink; linking again answers the same link and records nothing', async () => {
    const [a, b] = await pair();
    let routeLinkId = '';
    let portLinkId = '';
    const linked = await expectPortParity({
      viaRoute: () =>
        observe(a.id, async () => {
          const res = await route('POST', `/${a.id}/links`, { kind: 'order', id: orderId }, 201);
          routeLinkId = res!.data['id'] as string;
        }),
      viaPort: () =>
        observe(b.id, async () => {
          portLinkId = (await asAdmin(() => port.link(b.id, { kind: 'order', id: orderId }))).linkId;
        }),
    });
    expect(linked.port.audit.map((e) => e.action)).toEqual(['tasks.task.link']);
    const count = (await entries(b.id)).length;
    expect(await asAdmin(() => port.link(b.id, { kind: 'order', id: orderId }))).toEqual({ linkId: portLinkId });
    expect(await entries(b.id)).toHaveLength(count);

    const unlinked = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `/${a.id}/links/${routeLinkId}`, undefined, 204)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.unlink(b.id, portLinkId))),
    });
    expect(unlinked.port.audit.map((e) => e.action)).toEqual(['tasks.task.unlink']);
  });

  it('addReminder — tasks.reminder.add; answers the reminder’s id', async () => {
    const [a, b] = await pair();
    const body = { remindAt: '2032-03-10T09:00:00.000Z', recipientIds: [TEST_ADMIN_ID] };
    let reminderId = '';
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `/${a.id}/reminders`, body, 201)),
      viaPort: () =>
        observe(b.id, async () => {
          reminderId = (await asAdmin(() => port.addReminder(b.id, body))).reminderId;
        }),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.reminder.add']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ reminderId });
  });

  it('addComment — tasks.comment.add, the assignee told as on the route', async () => {
    const [a, b] = await pair({ assigneeIds: [colleague.adminUserId] });
    let commentId = '';
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('POST', `/${a.id}/comments`, { body: 'Measured.' }, 201), () => bells(a.id)),
      viaPort: () =>
        observe(
          b.id,
          async () => {
            commentId = (await asAdmin(() => port.addComment(b.id, { body: 'Measured.' }))).commentId;
          },
          () => bells(b.id),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.comment.add']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ commentId });
    // The assignment's bell and the comment's.
    expect(viaPort.sideEffects).toBe(2);
  });

  it('delete — tasks.task.delete, as the admin delete', async () => {
    const [a, b] = await pair();
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a.id, () => route('DELETE', `/${a.id}`)),
      viaPort: () => observe(b.id, () => asAdmin(() => port.delete(b.id))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.delete']);
    expect(await refusal(asAdmin(() => port.delete(b.id)))).toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.TASK_NOT_FOUND,
    });
  });

  it('createMany and deleteInContext — what taskWritePort did, which now delegates', async () => {
    const writePort = h.container.resolve<TaskWritePort>('taskWritePort');
    const contextA = randomUUID();
    const contextB = randomUUID();
    probeContexts.add(contextA).add(contextB);
    const entry = () => [{ title: 'Stage work', sourceKey: 'def-1', assigneeIds: [colleague.adminUserId] }];
    let oldId = '';
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(
          (result: { ids: string[] }) => result.ids[0]!,
          () => asAdmin(() => writePort.createMany({ context: { contextType: PROBE_CONTEXT, contextId: contextA }, tasks: entry() })),
          (result) => {
            oldId = result.ids[0]!;
            return bells(oldId);
          },
        ),
      viaPort: () =>
        observe(
          (result: { ids: string[] }) => result.ids[0]!,
          () => asAdmin(() => port.createMany({ context: { contextType: PROBE_CONTEXT, contextId: contextB }, tasks: entry() })),
          (result) => bells(result.ids[0]!),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['tasks.task.create']);
    // The context owner's path rings nobody (R-23.7).
    expect(viaPort.sideEffects).toBe(0);
    // Idempotent by source key, through either name.
    const again = await asAdmin(() =>
      port.createMany({ context: { contextType: PROBE_CONTEXT, contextId: contextB }, tasks: entry() }, { source: 'stage.sync' }),
    );
    expect(again.ids).toHaveLength(1);
    expect((await entries(again.ids[0]!)).map((e) => e.action)).toEqual(['tasks.task.create']);

    const deleted = await expectPortParity({
      viaRoute: () =>
        observe(
          oldId,
          () => asAdmin(() => writePort.deleteInContext({ contextType: PROBE_CONTEXT, contextId: contextA })),
        ),
      viaPort: () =>
        observe(again.ids[0]!, () => asAdmin(() => port.deleteInContext({ contextType: PROBE_CONTEXT, contextId: contextB }))),
    });
    expect(deleted.port.audit.map((e) => e.action)).toEqual(['tasks.task.delete']);

    // The caller's source reaches every Command the owner's path runs.
    const contextC = randomUUID();
    probeContexts.add(contextC);
    const [sourced] = (
      await asAdmin(() =>
        port.createMany({ context: { contextType: PROBE_CONTEXT, contextId: contextC }, tasks: entry() }, { source: 'stage.sync' }),
      )
    ).ids;
    await asAdmin(() => port.deleteInContext({ contextType: PROBE_CONTEXT, contextId: contextC }, { source: 'stage.sync' }));
    const trail = await entries(sourced!);
    expect(trail.map((e) => [e.action, e.stateAfter?.['source']])).toEqual([
      ['tasks.task.create', 'stage.sync'],
      ['tasks.task.delete', 'stage.sync'],
    ]);
  });

  it('records source beside the actor, and refuses a malformed source or an unclaimed extension with nothing written', async () => {
    const [task] = await pair();
    await asAdmin(() => port.update(task.id, { title: 'With a source' }, { source: 'erp.tasks', expectedVersion: 99 }));
    const written = await entries(task.id);
    expect(written.at(-1)).toMatchObject({ action: 'tasks.task.update', actorAdminUserId: TEST_ADMIN_ID });
    expect(written.at(-1)!.stateAfter).toMatchObject({ source: 'erp.tasks' });

    const count = written.length;
    expect(await refusal(asAdmin(() => port.update(task.id, { title: 'Nope' }, { source: 'Not A Code' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    // No Task action is hookable: every key is refused before anything is written.
    expect(
      await refusal(asAdmin(() => port.update(task.id, { title: 'Nope' }, { extensions: { acme_erp: { code: 'x' } } }))),
    ).toMatchObject({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });
    expect(
      await refusal(asAdmin(() => port.setStatus(task.id, { to: 'in_progress' }, { extensions: { acme_erp: {} } }))),
    ).toMatchObject({ statusCode: 422, code: 'COMMAND_EXTENSION_UNCLAIMED' });
    expect(await entries(task.id)).toHaveLength(count);
    expect(await refusal(asAdmin(() => port.update(task.id, { title: '' })))).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });

  it('runs under the bare system scope as the system actor, and refuses there what needs an administrator', async () => {
    const [task, other] = await pair({ draft: true });
    const record = await asSystem(() => port.update(task.id, { title: 'By the system' }, { source: 'nightly.sync' }));
    expect(record.title).toBe('By the system');
    const written = await entries(task.id);
    expect(written.at(-1)!.action).toBe('tasks.task.update');
    expect(written.at(-1)!.actorAdminUserId ?? null).toBeNull();
    expect(written.at(-1)!.stateAfter).toMatchObject({ source: 'nightly.sync' });

    const count = written.length;
    const forbidden = { statusCode: 403, code: ERROR_CODES.FORBIDDEN };
    expect(await refusal(asSystem(() => port.create({ title: 'Nobody’s Task' })))).toMatchObject(forbidden);
    expect(
      await refusal(
        asSystem(() => port.createMany({ context: { contextType: PROBE_CONTEXT, contextId: randomUUID() }, tasks: [{ title: 'Nobody’s Task' }] })),
      ),
    ).toMatchObject(forbidden);
    expect(await refusal(asSystem(() => port.publish(task.id)))).toMatchObject(forbidden);
    expect(await refusal(asSystem(() => port.relate(task.id, other.id)))).toMatchObject(forbidden);
    expect(await refusal(asSystem(() => port.link(task.id, { kind: 'order', id: orderId })))).toMatchObject(forbidden);
    expect(
      await refusal(asSystem(() => port.addReminder(task.id, { remindAt: '2032-03-10T09:00:00.000Z', recipientIds: [TEST_ADMIN_ID] }))),
    ).toMatchObject(forbidden);
    expect(await refusal(asSystem(() => port.addComment(task.id, { body: 'Nobody’s' })))).toMatchObject(forbidden);
    expect(await entries(task.id)).toHaveLength(count);
    expect(await tasksTitled('Nobody’s Task')).toBe(0);

    // Another administrator's private Task is read-only to the system, except for its deletion.
    const secret = await createTask({ private: true });
    expect(await refusal(asSystem(() => port.update(secret.id, { title: 'Peeked' })))).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.TASK_PRIVATE_READ_ONLY,
    });
    await asSystem(() => port.delete(secret.id));
    expect(await entries(secret.id).then((rows) => rows.at(-1)?.action)).toBe('tasks.task.delete');
  });

  it('fails closed while tasks is off, and nothing is written', async () => {
    const [task] = await pair();
    const count = (await entries(task.id)).length;
    await withModuleOff('tasks', 'deactivated', async () => {
      await expect(
        asAdmin(async () => h.container.resolve<TaskCommandPort>('taskCommandPort').update(task.id, { title: 'Off' })),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect(await entries(task.id)).toHaveLength(count);
    expect((await asAdmin(() => port.update(task.id, { title: 'On again' }))).title).toBe('On again');
  });
});
