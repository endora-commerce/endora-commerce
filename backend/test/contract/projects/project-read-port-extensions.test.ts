import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ProjectDetail, type ProjectReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrder, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, setProjectsVisibility } from '../../integration/projects/helpers.js';

/**
 * `specs/187-side-table-extensions/` T045 (FR-054 – FR-058) —
 * `ProjectReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByRecord`, `findByIds` and `search`.
 *
 * The port is the composition's own (`projectReadPort`), called as an
 * administrator under `ProjectAccess`. The include is served by the probe module
 * of `helpers/entity-extension-probe.ts`; the loader is handed only the Projects
 * the caller may see (FR-056, research R-12): a Project hidden from the caller
 * never reaches it.
 */

const HOST = 'projects.Project';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
let member: Person;
let other: Person;
let hidden: ProjectDetail;
let order = '';
const visible: ProjectDetail[] = [];
const created: string[] = [];
const stamp = Date.now().toString(36);

const port = (): ProjectReadPort => h.container.resolve<ProjectReadPort>('projectReadPort');
const as = <R>(adminUserId: string, body: () => Promise<R>): Promise<R> =>
  runWithTenantContext(
    resolveTenantContext({ kind: 'admin', adminUserId }, { allowAll: true, allowedOrganizationIds: [] }),
    body,
  );
const probed = <R>(adminUserId: string, run: () => Promise<R>) =>
  statementsOf(h.orm, () => withProbeReads(h.container, probe, () => as(adminUserId, run)));

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'projects');
  member = await seedCrmAdmin(h.em(), 'probe-member', ['projects:read']);
  other = await seedCrmAdmin(h.em(), 'probe-other', ['projects:read']);
  await setProjectsVisibility(h, 'members');
  const organization = await seedCrmOrganization(h.em(), `Probe projects ${stamp}`);
  for (let index = 0; index < 50; index += 1) {
    const project = await createProject(h, {
      title: `Probe ${stamp} ${index.toString().padStart(2, '0')}`,
      visibility: 'everyone',
      organizationIds: [organization],
    });
    visible.push(project);
    created.push(project.id);
  }
  hidden = await createProject(h, {
    title: `Probe ${stamp} hidden`,
    visibility: 'members_and_listed',
    organizationIds: [organization],
    members: [{ adminUserId: member.adminUserId, roleIds: [] }],
  });
  created.push(hidden.id);
  order = (await seedCrmOrder(h.em(), { organizationId: organization })).id;
  const link = await callProjects(h, 'POST', `/${visible[0]!.id}/links`, { payload: { kind: 'order', recordId: order } });
  expect(link.statusCode, link.body).toBe(201);
}, 600_000);

afterAll(async () => {
  for (const person of [member, other]) person?.undo();
  await deleteProjects(h, created);
  await teardownBackendServer(h);
});

describe('ProjectReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = visible[0]!.id;
    const query = { q: `Probe ${stamp} 00`, limit: 5 };
    const baseline = JSON.stringify(
      await as(other.adminUserId, async () => [
        await port().findById(id),
        await port().findByRecord('order', order),
        await port().findByIds([id]),
        await port().search(query),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(other.adminUserId, async () => [
        await port().findById(id, options),
        await port().findByRecord('order', order, options),
        await port().findByIds([id], options),
        await port().search(query, options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('ProjectReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByRecord, findByIds and search', async () => {
    const id = visible[0]!.id;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(other.adminUserId, async () => ({
      one: await port().findById(id, INCLUDE),
      byRecord: await port().findByRecord('order', order, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      searched: await port().search({ q: `Probe ${stamp} 00`, limit: 5 }, INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await as(other.adminUserId, () => port().findById(id))), extensions: value });
    expect(result.byRecord?.extensions).toEqual(value);
    expect(result.many[0]?.extensions).toEqual(value);
    expect(result.searched.map((record) => record.extensions)).toEqual([value]);
  });

  it('loads 50 Projects’ values with exactly one loader statement, handed only the Projects the caller may see', async () => {
    probe.calls.length = 0;
    const ids = [...visible.map((project) => project.id), hidden.id];
    const { result, statements } = await probed(other.adminUserId, () => port().findByIds(ids, INCLUDE));
    expect(result).toHaveLength(50);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).not.toContain(hidden.id);
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
    // A member who may see the hidden one hands it over as well.
    probe.calls.length = 0;
    const asMember = await probed(member.adminUserId, () => port().findByIds(ids, INCLUDE));
    expect(asMember.result).toHaveLength(51);
    expect(probe.calls[0]).toContain(hidden.id);
  });

  it('runs no loader for a Project hidden from the caller: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(other.adminUserId, () => port().findById(hidden.id, INCLUDE));
    expect(result).toBeNull();
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const id = visible[0]!.id;
      const { result, statements } = await probed(other.adminUserId, () => port().findById(id, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await as(other.adminUserId, () => port().findById(id))));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    const error = await as(other.adminUserId, () => port().findById(visible[0]!.id, INCLUDE)).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
  });
});
