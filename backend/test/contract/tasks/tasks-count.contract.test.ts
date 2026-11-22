import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TaskCountResponseSchema,
  TaskListResponseSchema,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * `GET /api/v1/admin/tasks/count`
 * (`specs/183-record-tab-contributions/contracts/task-count-api.md`, plan MR-A).
 *
 * The count is how many rows `GET /tasks` would answer under the same filters
 * for the same caller, across every page. The caller is a holder of
 * `tasks:read` alone, so the draft/private conjunct narrows it: another
 * admin's private Task and another admin's draft are left out, its own
 * private Task is not. A Task in a context the caller may not see is left out
 * as well — the same pre-filter as the list.
 *
 * Seven Tasks carry one token in their titles, so `q` scopes every request to
 * them; they are seeded in SQL, as `tasks-list.contract.test.ts` seeds its own.
 */
describe('tasks (contract) — GET /tasks/count (spec 183)', () => {
  let h: BackendServerHandle;
  let reader: Awaited<ReturnType<typeof seedCrmAdmin>>;
  let other: Awaited<ReturnType<typeof seedCrmAdmin>>;
  let nobody: Awaited<ReturnType<typeof seedCrmAdmin>>;
  const API = '/api/v1/admin/tasks';
  const token = `cnt${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const opportunity = randomUUID();
  const hiddenContext = randomUUID();
  const shownContext = randomUUID();
  const id = {
    open1: randomUUID(),
    open2: randomUUID(),
    open3: randomUUID(),
    done: randomUUID(),
    ownPrivate: randomUUID(),
    othersPrivate: randomUUID(),
    othersDraft: randomUUID(),
    hiddenContext: randomUUID(),
    shownContext: randomUUID(),
    unlinked: randomUUID(),
  };

  async function count(query: string, cookies = reader.cookies): Promise<number> {
    const response = await h.app.inject({ method: 'GET', url: `${API}/count?q=${token}&${query}`, cookies });
    expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
    return TaskCountResponseSchema.parse(response.json()).data.count;
  }

  /** Every row the list answers the reader under `query`, two to a page. */
  async function listed(query: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const response = await h.app.inject({
        method: 'GET',
        url: `${API}?q=${token}&${query}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookies: reader.cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      const page = TaskListResponseSchema.parse(response.json());
      out.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (!cursor) return out;
    }
    throw new Error('the list did not end');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), 'tasks-count-reader', ['tasks:read']);
    other = await seedCrmAdmin(h.em(), 'tasks-count-other', ['tasks:read', 'tasks:write']);
    nobody = await seedCrmAdmin(h.em(), 'tasks-count-nobody', ['orders:read']);
    // A context type whose owner lets the caller see one record and not another.
    const probe: TaskContextDescriptor = {
      contextType: 'count_probe',
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [shownContext],
      visibleContextIds: async (ids) => new Set(ids.filter((value) => value === shownContext)),
      canSeeAs: async (_adminUserId, value) => value === shownContext,
      canChangeTasks: async () => false,
      describe: async (ids) =>
        new Map(
          ids
            .filter((value) => value === shownContext)
            .map((value) => [value, { label: 'Probe record', href: `/probe/${value}`, groups: new Map() }]),
        ),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);

    const rows: Array<{
      id: string;
      status: string;
      creator: string;
      draft?: boolean;
      private?: boolean;
      context?: string;
      linked: boolean;
    }> = [
      { id: id.open1, status: 'todo', creator: other.adminUserId, linked: true },
      { id: id.open2, status: 'in_progress', creator: other.adminUserId, linked: true },
      { id: id.open3, status: 'todo', creator: reader.adminUserId, linked: true },
      { id: id.done, status: 'done', creator: other.adminUserId, linked: true },
      { id: id.ownPrivate, status: 'todo', creator: reader.adminUserId, private: true, linked: true },
      { id: id.othersPrivate, status: 'todo', creator: other.adminUserId, private: true, linked: true },
      { id: id.othersDraft, status: 'todo', creator: other.adminUserId, draft: true, linked: true },
      { id: id.hiddenContext, status: 'todo', creator: other.adminUserId, context: hiddenContext, linked: true },
      { id: id.shownContext, status: 'todo', creator: other.adminUserId, context: shownContext, linked: true },
      { id: id.unlinked, status: 'todo', creator: other.adminUserId, linked: false },
    ];
    const connection = h.orm.em.getConnection();
    let n = 0;
    for (const row of rows) {
      n += 1;
      await connection.execute(
        `insert into "tasks" ("id", "number", "title", "status", "is_draft", "is_private", "context_type", "context_id",
           "created_by_admin_user_id", "published_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [
          row.id,
          `TSK-C${token}-${n}`,
          `${token} ${n}`,
          row.status,
          row.draft ?? false,
          row.private ?? false,
          row.context ? 'count_probe' : null,
          row.context ?? null,
          row.creator,
          row.draft ? null : new Date().toISOString(),
        ],
      );
      if (row.linked) {
        await connection.execute(
          `insert into "task_record_links" ("task_id", "record_kind", "record_id", "linked_by_admin_user_id") values (?, 'opportunity', ?, ?)`,
          [row.id, opportunity, row.creator],
        );
      }
    }
  });

  afterAll(async () => {
    const connection = h.orm.em.getConnection();
    await connection.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(id).join(',')}}`]);
    reader.undo();
    other.undo();
    nobody.undo();
    await teardownBackendServer(h);
  });

  it('equals the list total across more than one page, for the same filters', async () => {
    for (const query of ['', `linkedKind=opportunity&linkedId=${opportunity}`, 'statusCategory=open', 'status=done']) {
      const rows = await listed(query);
      expect(await count(query), query).toBe(rows.length);
    }
    // More than one page of two, so the count is not a page length.
    expect(await count('')).toBeGreaterThan(2);
  });

  it("leaves out another admin's private Task, another admin's draft and a Task in a hidden context", async () => {
    const visible = await listed('');
    expect(visible).not.toContain(id.othersPrivate);
    expect(visible).not.toContain(id.othersDraft);
    expect(visible).not.toContain(id.hiddenContext);
    expect(visible).toContain(id.ownPrivate);
    expect(visible).toContain(id.shownContext);
    // open1, open2, open3, done, ownPrivate, shownContext, unlinked.
    expect(await count('')).toBe(7);
  });

  it("the Tasks tab's query: open Tasks linked to the opportunity", async () => {
    // open1, open2, open3, ownPrivate, shownContext — `done` and `unlinked` left out.
    expect(await count(`linkedKind=opportunity&linkedId=${opportunity}&statusCategory=open`)).toBe(5);
    expect(await count(`linkedKind=opportunity&linkedId=${opportunity}`)).toBe(6);
  });

  it('an unknown record, status or tag matches nothing and is not refused', async () => {
    expect(await count(`linkedKind=opportunity&linkedId=${randomUUID()}`)).toBe(0);
    expect(await count('status=not_a_status')).toBe(0);
    expect(await count(`tagId=${randomUUID()}`)).toBe(0);
  });

  it('refuses a half-linked pair, paging and sorting — 400', async () => {
    for (const query of [`linkedKind=opportunity`, `linkedId=${opportunity}`, 'limit=10', 'cursor=abc', 'sort=title']) {
      const response = await h.app.inject({ method: 'GET', url: `${API}/count?${query}`, cookies: reader.cookies });
      expect(response.statusCode, `${query}: ${response.body}`).toBe(400);
    }
  });

  it('refuses a custom-field filter the list does not offer — 400', async () => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${API}/count?customFieldFilters=${encodeURIComponent(JSON.stringify({ no_such_field: { in: ['x'] } }))}`,
      cookies: reader.cookies,
    });
    expect(response.statusCode, response.body).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('CUSTOM_FIELD_FILTER_UNAVAILABLE');
  });

  it('answers 401 without a session and 403 without tasks:read', async () => {
    expect((await h.app.inject({ method: 'GET', url: `${API}/count` })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: `${API}/count`, cookies: nobody.cookies })).statusCode).toBe(403);
  });

  it('is a static segment, not read as a Task id by /:id', async () => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/count`, cookies: reader.cookies });
    expect(response.statusCode, response.body).toBe(200);
    expect(TaskCountResponseSchema.safeParse(response.json()).success).toBe(true);
  });

  const AXES: readonly OffStateAxis[] = ['deactivated', 'platform-unavailable'];
  for (const axis of AXES) {
    it(`is absent while tasks is off (${axis}), and answers again after`, async () => {
      await withModuleOff('tasks', axis, async () => {
        const response = await h.app.inject({ method: 'GET', url: `${API}/count`, cookies: reader.cookies });
        expect(response.statusCode, response.body).toBe(503);
        expect((response.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
      });
      expect(await count('')).toBe(7);
    });
  }
});
