import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OpportunityReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runToken, seedOrganization } from '../../helpers/admin-search-fixtures.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import { CrmOpportunity, CrmOpportunityLink } from '../../helpers/package-entities.js';
import { restoreDefaultCrmWorkflow } from '../../helpers/seed-crm.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T044 (FR-054 – FR-058) —
 * `OpportunityReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByDocument`, `listOpenForOrganization`,
 * `findByIds` and `search`.
 *
 * The port is the composition's own (`opportunityReadPort`), called under an
 * administrator's context reaching Organization A only; `CrmOpportunity` is
 * `@OrgScoped`, so an Opportunity of B is absent and never reaches the loader
 * (FR-056). The include is served by the probe module of
 * `helpers/entity-extension-probe.ts`.
 */

const HOST = 'crm.CrmOpportunity';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const T = runToken();
const ids: string[] = [];
let foreignId = '';
let organizationA = '';
let organizationB = '';
const documentOfA = randomUUID();
const documentOfB = randomUUID();

const port = (): OpportunityReadPort => h.container.resolve<OpportunityReadPort>('opportunityReadPort');
/** As an administrator confined to Organization A. */
const asA = <R>(body: () => Promise<R>): Promise<R> =>
  runWithTenantContext(
    resolveTenantContext(
      { kind: 'admin', adminUserId: randomUUID() },
      { allowAll: false, allowedOrganizationIds: [organizationA] },
    ),
    body,
  );
const probed = <R>(run: () => Promise<R>) => statementsOf(h.orm, () => withProbeReads(h.container, probe, () => asA(run)));
const markerOf = (id: string) => ({ acme_probe: { marker: `probe:${id}` } });
const SEARCH = { q: `PRB-${T}-`, limit: 20 };

beforeAll(async () => {
  h = await setupBackendServer();
  await restoreDefaultCrmWorkflow(h.em());
  probe = entityExtensionProbe(HOST, 'crm_opportunities');
  await withSystemScope('test seed: opportunity read port extensions', async () => {
    const em = h.em();
    organizationA = (await seedOrganization(em, { name: `Probe Opportunities A ${T}` })).id;
    organizationB = (await seedOrganization(em, { name: `Probe Opportunities B ${T}` })).id;
    const opportunity = (organizationId: string, number: string) => {
      const row = em.create(CrmOpportunity, {
        number,
        title: `Probe ${number}`,
        organizationId,
        statusCode: 'new',
        currency: 'PLN',
      } as never);
      em.persist(row);
      return (row as { id: string }).id;
    };
    for (let index = 0; index < 50; index += 1) {
      ids.push(opportunity(organizationA, `PRB-${T}-${index.toString().padStart(2, '0')}`));
    }
    foreignId = opportunity(organizationB, `PRB-${T}-B`);
    // A link names its Opportunity by id, not by relation: flush the parents first.
    await em.flush();
    for (const [opportunityId, documentId] of [
      [ids[3]!, documentOfA],
      [foreignId, documentOfB],
    ] as const) {
      em.persist(em.create(CrmOpportunityLink, { opportunityId, documentKind: 'order', documentId, linkSource: 'manual' } as never));
    }
    await em.flush();
  });
}, 600_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

describe('OpportunityReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[3]!;
    const baseline = JSON.stringify(
      await asA(async () => [
        await port().findById(id),
        await port().findByDocument('order', documentOfA),
        await port().listOpenForOrganization(organizationA),
        await port().findByIds([id]),
        await port().search(SEARCH),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByDocument('order', documentOfA, options),
        await port().listOpenForOrganization(organizationA, options),
        await port().findByIds([id], options),
        await port().search(SEARCH, options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('OpportunityReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on every record method', async () => {
    const id = ids[3]!;
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      byDocument: await port().findByDocument('order', documentOfA, INCLUDE),
      open: await port().listOpenForOrganization(organizationA, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      searched: await port().search(SEARCH, INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await asA(() => port().findById(id))), extensions: markerOf(id) });
    expect(result.byDocument?.extensions).toEqual(markerOf(id));
    expect(result.open.find((record) => record.id === id)?.extensions).toEqual(markerOf(id));
    expect(result.many[0]?.extensions).toEqual(markerOf(id));
    expect(result.searched).toHaveLength(20);
    for (const record of result.searched) expect(record.extensions).toEqual(markerOf(record.id));
  });

  it('loads 50 records’ values with exactly one loader statement, handed only the ids the caller may read', async () => {
    for (const read of [
      () => port().findByIds([...ids, foreignId], INCLUDE),
      () => port().listOpenForOrganization(organizationA, INCLUDE),
    ]) {
      probe.calls.length = 0;
      const { result, statements } = await probed(read);
      expect(result).toHaveLength(50);
      expect(result.map((record) => record.id)).not.toContain(foreignId);
      expect(probeStatements(statements)).toHaveLength(1);
      expect(probe.calls).toEqual([result.map((record) => record.id)]);
      for (const record of result) expect(record.extensions).toEqual(markerOf(record.id));
    }
  });

  it('runs no loader for an Opportunity out of reach: findById and findByDocument answer null, B’s list is empty', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(async () => [
      await port().findById(foreignId, INCLUDE),
      await port().findByDocument('order', documentOfB, INCLUDE),
      await port().listOpenForOrganization(organizationB, INCLUDE),
    ]);
    expect(result).toEqual([null, null, []]);
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const { result, statements } = await probed(() => port().findById(ids[3]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await asA(() => port().findById(ids[3]!))));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    const error = await asA(() => port().findById(ids[3]!, INCLUDE)).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
  });
});
