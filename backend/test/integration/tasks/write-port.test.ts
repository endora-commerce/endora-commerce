import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TASKS_EVENTS,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
  type TaskReadPort,
  type TaskWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';

/**
 * `taskWritePort` — another module creating and deleting Tasks in a context it
 * owns (`specs/163-projects-and-tasks/contracts/ports-and-events.md` §1).
 *
 * One `tasks.task.create` Command per Task, so each has its own audit row and
 * its own `tasks.task.created.v1`; at most 100 per call; the context's type
 * must be registered by a present module. The probe context is owned by `crm`
 * for the length of this file, a toggleable module.
 */
describe('tasks — the write port', () => {
  let h: BackendServerHandle;
  const visible = new Set<string>();
  const asAdmin = <T>(fn: () => Promise<T>) =>
    runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } }, fn);
  const writePort = () => h.container.resolve<TaskWritePort>('taskWritePort');
  const readPort = () => h.container.resolve<TaskReadPort>('taskReadPort');

  async function taskCount(contextId: string): Promise<number> {
    const rows = (await h.orm.em.getConnection().execute(
      `select count(*)::int as n from "tasks" where "context_id" = ?`,
      [contextId],
    )) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? '' };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const probe: TaskContextDescriptor = {
      contextType: 'write_probe',
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [...visible],
      visibleContextIds: async (ids) => new Set(ids.filter((id) => visible.has(id))),
      canSeeAs: async (_adminUserId, id) => visible.has(id),
      canChangeTasks: async () => false,
      describe: async () => new Map(),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);
  });

  afterAll(async () => {
    await h.orm.em.getConnection().execute(`delete from "tasks" where "context_type" = 'write_probe'`);
    await teardownBackendServer(h);
  });

  it('creates one Task per entry, each by its own Command with its own audit row and event', async () => {
    const contextId = randomUUID();
    const groupId = randomUUID();
    visible.add(contextId);
    const created: unknown[] = [];
    const off = h.eventBus.on(TASKS_EVENTS.CREATED as never, (payload: unknown) => {
      created.push(payload);
    });
    try {
      const { ids } = await asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId, contextGroupId: groupId },
          tasks: [
            { title: 'Measure the showroom', dueOn: '2026-11-02', contextNote: 'Responsible role: Installer' },
            { title: 'Order the fittings', assigneeIds: [TEST_ADMIN_ID] },
          ],
        }),
      );
      expect(ids).toHaveLength(2);

      const records = await asAdmin(() => readPort().listInContext({ contextType: 'write_probe', contextId }));
      expect(records.map((r) => r.id).sort()).toEqual([...ids].sort());
      const measure = records.find((r) => r.title === 'Measure the showroom')!;
      expect(measure).toMatchObject({
        status: 'todo',
        statusCategory: 'open',
        closed: false,
        draft: false,
        private: false,
        dueOn: '2026-11-02',
        contextGroupId: groupId,
        contextNote: 'Responsible role: Installer',
        assigneeIds: [],
      });
      expect(measure.number).toMatch(/^TSK-\d{6,}$/);
      expect(records.find((r) => r.title === 'Order the fittings')!.assigneeIds).toEqual([TEST_ADMIN_ID]);

      for (const id of ids) {
        const audit = await h.auditLogService.query({ action: 'tasks.task.create', objectId: id });
        expect(audit, id).toHaveLength(1);
        expect(audit[0]).toMatchObject({ objectType: 'task' });
      }
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({ contextType: 'write_probe', contextId, contextGroupId: groupId });
    } finally {
      off();
    }
  });

  it('refuses a context type nobody registered — nothing is created', async () => {
    const contextId = randomUUID();
    const refused = await refusal(
      asAdmin(() =>
        writePort().createMany({ context: { contextType: 'nobody_owns_this', contextId }, tasks: [{ title: 'x' }] }),
      ),
    );
    expect(refused).toEqual({ statusCode: 422, code: 'TASK_CONTEXT_INVALID' });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses a context whose owner is off — nothing is created', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    await withModuleOff('crm', 'deactivated', async () => {
      const refused = await refusal(
        asAdmin(() =>
          writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: 'x' }] }),
        ),
      );
      expect(refused).toEqual({ statusCode: 422, code: 'TASK_CONTEXT_INVALID' });
    });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses an assignee who is not an active administrator — nothing is created', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    const refused = await refusal(
      asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId },
          tasks: [{ title: 'fine' }, { title: 'nobody', assigneeIds: [randomUUID()] }],
        }),
      ),
    );
    expect(refused).toEqual({ statusCode: 422, code: 'TASK_ASSIGNEE_INVALID' });
    expect(await taskCount(contextId)).toBe(0);
  });

  it('refuses more than 100 Tasks in one call, and an invalid entry, before writing anything', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    const tooMany = await refusal(
      asAdmin(() =>
        writePort().createMany({
          context: { contextType: 'write_probe', contextId },
          tasks: Array.from({ length: 101 }, (_, i) => ({ title: `t${i}` })),
        }),
      ),
    );
    expect(tooMany).toEqual({ statusCode: 422, code: 'VALIDATION_FAILED' });
    const blank = await refusal(
      asAdmin(() =>
        writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: '   ' }] }),
      ),
    );
    expect(blank).toEqual({ statusCode: 422, code: 'VALIDATION_FAILED' });
    expect(await taskCount(contextId)).toBe(0);
  });

  describe('a source key makes creation idempotent (R-19, issue #450)', () => {
    const keysOf = async (contextId: string): Promise<Array<{ id: string; source_key: string | null }>> =>
      (await h.orm.em
        .getConnection()
        .execute(`select "id", "source_key" from "tasks" where "context_id" = ? order by "source_key", "id"`, [
          contextId,
        ])) as Array<{ id: string; source_key: string | null }>;

    it('skips a key the context already holds and answers its id in input order; a key is per context', async () => {
      const contextId = randomUUID();
      const other = randomUUID();
      visible.add(contextId);
      visible.add(other);
      const context = { contextType: 'write_probe', contextId };
      const first = await asAdmin(() =>
        writePort().createMany({ context, tasks: [{ title: 'A', sourceKey: 'a' }, { title: 'B', sourceKey: 'b' }] }),
      );
      const [idA, idB] = first.ids;

      const second = await asAdmin(() =>
        writePort().createMany({
          context,
          tasks: [
            { title: 'B again', sourceKey: 'b' },
            { title: 'C', sourceKey: 'c' },
            { title: 'A again', sourceKey: 'a' },
            { title: 'No key' },
            { title: 'C twice in one call', sourceKey: 'c' },
          ],
        }),
      );
      expect(second.ids).toHaveLength(5);
      expect(second.ids[0]).toBe(idB);
      expect(second.ids[2]).toBe(idA);
      expect(second.ids[4]).toBe(second.ids[1]);
      expect(new Set(second.ids).size).toBe(4);
      expect((await keysOf(contextId)).map((r) => r.source_key)).toEqual(['a', 'b', 'c', null]);
      // A Task skipped is not written again: its title and its one audit row stand.
      const rows = (await h.orm.em.getConnection().execute(`select "title" from "tasks" where "id" = ?`, [idA])) as Array<{
        title: string;
      }>;
      expect(rows[0]!.title).toBe('A');
      expect(await h.auditLogService.query({ action: 'tasks.task.create', objectId: idA! })).toHaveLength(1);

      const elsewhere = await asAdmin(() =>
        writePort().createMany({ context: { contextType: 'write_probe', contextId: other }, tasks: [{ title: 'A', sourceKey: 'a' }] }),
      );
      expect(elsewhere.ids[0]).not.toBe(idA);
      expect(await keysOf(other)).toHaveLength(1);
    });

    it('two calls at once create each key once, and both answer the same ids', async () => {
      const contextId = randomUUID();
      visible.add(contextId);
      const tasks = ['k1', 'k2', 'k3', 'k4', 'k5'].map((sourceKey) => ({ title: sourceKey, sourceKey }));
      const call = () => asAdmin(() => writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks }));
      const [a, b] = await Promise.all([call(), call()]);
      expect(a.ids).toEqual(b.ids);
      const rows = await keysOf(contextId);
      expect(rows.map((r) => r.source_key)).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
      expect(rows.map((r) => r.id)).toEqual(a.ids);
    });

    it('a key another call is creating at that moment is answered with that call’s Task, not refused', async () => {
      const contextId = randomUUID();
      visible.add(contextId);
      // The other call's Command, mid-transaction: its Task holds the key, uncommitted.
      const holder = h.em().fork();
      await holder.begin();
      const theirs = randomUUID();
      let pending: Promise<{ ids: string[] }> | undefined;
      try {
        await holder.execute(
          `insert into "tasks" ("id", "number", "title", "status", "created_by_admin_user_id", "context_type", "context_id",
                                "source_key", "published_at")
           values (?, ?, 'Theirs', 'todo', ?, 'write_probe', ?, 'raced', now())`,
          [theirs, `TSK-W${theirs.slice(0, 6).toUpperCase()}`, TEST_ADMIN_ID, contextId],
        );
        pending = asAdmin(() =>
          writePort().createMany({
            context: { contextType: 'write_probe', contextId },
            tasks: [{ title: 'Ours', sourceKey: 'raced' }, { title: 'Also ours', sourceKey: 'free' }],
          }),
        );
        // Ours waits on the unique index until theirs commits.
        const deadline = Date.now() + 10_000;
        for (;;) {
          const [waiting] = (await h.orm.em
            .getConnection()
            .execute(`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'insert into "tasks"%'`)) as Array<{ n: number }>;
          if (Number(waiting?.n) > 0) break;
          if (Date.now() > deadline) throw new Error('the second create never waited on the unique index');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await holder.commit();
      } catch (error) {
        await holder.rollback().catch(() => undefined);
        throw error;
      }
      const { ids } = await pending!;
      expect(ids[0]).toBe(theirs);
      expect((await keysOf(contextId)).map((r) => r.source_key)).toEqual(['free', 'raced']);
      expect(await h.auditLogService.query({ action: 'tasks.task.create', objectId: theirs })).toEqual([]);
      // Issue #470 — the refused Command's value-store row went with it; the
      // committed one's stayed, beside its audit entry.
      const titled = async (title: string) =>
        ((await h.orm.em
          .getConnection()
          .execute(
            `select count(*)::int as n from "task_value_changes" v join "tasks" t on t."id" = v."task_id"
              where v."after"->>'title' = ? and t."context_id" = ?`,
            [title, contextId],
          )) as Array<{ n: number }>)[0]?.n;
      expect(await titled('Ours')).toBe(0);
      expect(await titled('Also ours')).toBe(1);
    });
  });

  it('deletes every Task of one context and no other, each with its own audit row', async () => {
    const doomed = randomUUID();
    const kept = randomUUID();
    visible.add(doomed);
    visible.add(kept);
    const { ids } = await asAdmin(() =>
      writePort().createMany({
        context: { contextType: 'write_probe', contextId: doomed },
        tasks: [{ title: 'one' }, { title: 'two' }],
      }),
    );
    await asAdmin(() =>
      writePort().createMany({ context: { contextType: 'write_probe', contextId: kept }, tasks: [{ title: 'three' }] }),
    );

    const result = await asAdmin(() => writePort().deleteInContext({ contextType: 'write_probe', contextId: doomed }));
    expect(result).toEqual({ deleted: 2 });
    expect(await taskCount(doomed)).toBe(0);
    expect(await taskCount(kept)).toBe(1);
    for (const id of ids) {
      expect(await h.auditLogService.query({ action: 'tasks.task.delete', objectId: id }), id).toHaveLength(1);
    }
  });

  it('is gated: with tasks off, resolving either port refuses with MODULE_DISABLED', async () => {
    const contextId = randomUUID();
    visible.add(contextId);
    await withModuleOff('tasks', 'deactivated', async () => {
      await expect(
        (async () =>
          asAdmin(() =>
            writePort().createMany({ context: { contextType: 'write_probe', contextId }, tasks: [{ title: 'x' }] }),
          ))(),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
      await expect(
        (async () => asAdmin(() => readPort().countInContext({ contextType: 'write_probe', contextId })))(),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    });
    expect(await taskCount(contextId)).toBe(0);
  });
});
