import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
  type TaskReadPort,
} from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T046 (FR-054 – FR-058) —
 * `TaskReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByIds`, `search`, `listInContext` and
 * `listOpenInContext`.
 *
 * The port is the composition's own (`taskReadPort`), called as an
 * administrator **without** `tasks:see_private`. The include is served by the
 * probe module of `helpers/entity-extension-probe.ts`; the loader is handed
 * only the Tasks the caller may see (FR-056, research R-12): another
 * administrator's private Task in the same context never reaches it.
 *
 * The fixture is 50 published Tasks in one context of a probe context type,
 * and one private Task of another administrator (a private Task has no
 * context: `tasks_private_context_check`).
 */

const HOST = 'tasks.Task';
const INCLUDE = { include: ['extensions.acme_probe'] as const };
const PROBE_CONTEXT = 'extension_read_probe';

type Person = Awaited<ReturnType<typeof seedCrmAdmin>>;

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
let viewer: Person;
let other: Person;
const token = `xrp${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const contextId = randomUUID();
const context = { contextType: PROBE_CONTEXT, contextId };
/** Oldest first, as the context lists answer. */
const ids: string[] = [];
const privateId = randomUUID();

const port = (): TaskReadPort => h.container.resolve<TaskReadPort>('taskReadPort');
const asViewer = <R>(body: () => Promise<R>): Promise<R> =>
  runWithTenantContext(
    resolveTenantContext(
      { kind: 'admin', adminUserId: viewer.adminUserId },
      { allowAll: true, allowedOrganizationIds: [] },
    ),
    body,
  );
const probed = <R>(run: () => Promise<R>) => statementsOf(h.orm, () => withProbeReads(h.container, probe, () => asViewer(run)));

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'tasks');
  viewer = await seedCrmAdmin(h.em(), 'tasks-ext-viewer', ['tasks:read']);
  other = await seedCrmAdmin(h.em(), 'tasks-ext-other', ['tasks:read', 'tasks:write']);
  const descriptor: TaskContextDescriptor = {
    contextType: PROBE_CONTEXT,
    ownerModuleId: 'crm',
    allVisibleContextIds: async () => [contextId],
    visibleContextIds: async (candidates) => new Set(candidates.filter((id) => id === contextId)),
    canSeeAs: async (_adminUserId, id) => id === contextId,
    canChangeTasks: async () => true,
    describe: async () => new Map(),
  };
  h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(descriptor);
  const rows = [
    ...Array.from({ length: 50 }, (_, index) => ({ id: randomUUID(), creator: TEST_ADMIN_ID, private: false, index })),
    { id: privateId, creator: other.adminUserId, private: true, index: 50 },
  ];
  const connection = h.em().getConnection();
  for (const row of rows) {
    if (!row.private) ids.push(row.id);
    await connection.execute(
      `insert into "tasks" ("id", "number", "title", "status", "created_by_admin_user_id", "is_draft", "is_private",
         "published_at", "context_type", "context_id", "custom_field_values", "created_at", "updated_at")
       values (?, ?, ?, 'todo', ?, false, ?, now(), ?, ?, '{}'::jsonb, now() - make_interval(mins => ?::int), now())`,
      [
        row.id,
        `TSK-X${token}-${row.index}`,
        `${token} ${row.index}`,
        row.creator,
        row.private,
        row.private ? null : PROBE_CONTEXT,
        row.private ? null : contextId,
        100 - row.index,
      ],
    );
  }
}, 600_000);

afterAll(async () => {
  await h.em().getConnection().execute(`delete from "tasks" where "context_type" = ? or "id" = ?`, [PROBE_CONTEXT, privateId]);
  for (const person of [viewer, other]) person?.undo();
  await teardownBackendServer(h);
});

describe('TaskReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[3]!;
    const query = { q: `${token} 3`, limit: 5 };
    const baseline = JSON.stringify(
      await asViewer(async () => [
        await port().findById(id),
        await port().findByIds([id]),
        await port().search(query),
        await port().listInContext(context),
        await port().listOpenInContext(context),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByIds([id], options),
        await port().search(query, options),
        await port().listInContext(context, options),
        await port().listOpenInContext(context, options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('TaskReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByIds, search, listInContext and listOpenInContext', async () => {
    const id = ids[3]!;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      found: await port().search({ q: `TSK-X${token}-3`, limit: 20 }, INCLUDE),
      inContext: await port().listInContext(context, INCLUDE),
      open: await port().listOpenInContext(context, INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await asViewer(() => port().findById(id))), extensions: value });
    expect(result.many[0]?.extensions).toEqual(value);
    expect(result.found.find((record) => record.id === id)?.extensions).toEqual(value);
    expect(result.inContext.find((record) => record.id === id)?.extensions).toEqual(value);
    expect(result.open.find((record) => record.id === id)?.extensions).toEqual(value);
  });

  it('loads 50 records’ values with exactly one loader statement, never handed the private Task', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().findByIds([...ids, privateId], INCLUDE));
    expect(result).toHaveLength(50);
    expect(result.map((record) => record.id)).not.toContain(privateId);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).not.toContain(privateId);
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
  });

  it('the context lists hand the loader the context’s 50 Tasks in one statement each', async () => {
    for (const list of [() => port().listInContext(context, INCLUDE), () => port().listOpenInContext(context, INCLUDE)]) {
      probe.calls.length = 0;
      const { result, statements } = await probed(list);
      expect(result.map((record) => record.id)).toEqual(ids);
      expect(probeStatements(statements)).toHaveLength(1);
      expect(probe.calls).toEqual([ids]);
    }
  });

  it('search hands the loader only the visible Tasks it answers', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().search({ q: token, limit: 20 }, INCLUDE));
    expect(result).toHaveLength(20);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).not.toContain(privateId);
  });

  it('runs no loader for a private Task the caller may not see: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().findById(privateId, INCLUDE));
    expect(result).toBeNull();
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const { result, statements } = await probed(() => port().findById(ids[3]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await asViewer(() => port().findById(ids[3]!))));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    const error = await asViewer(() => port().findById(ids[3]!, INCLUDE)).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
  });
});
