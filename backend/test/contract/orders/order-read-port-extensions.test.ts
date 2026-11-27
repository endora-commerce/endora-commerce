import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OrderReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runToken, seedCustomer, seedOrder, seedOrganization } from '../../helpers/admin-search-fixtures.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T040 (FR-054 – FR-058, US4 scenario 5) —
 * `OrderReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByIdForCustomer`, `findByIds` and `listAll`.
 *
 * The port is the composition's own (`orderReadPort`), called under an
 * administrator's context reaching Organization A only. `orders.Order` is
 * `@OrgScoped`, so the tenant filter is what decides which orders the port
 * returns — and the loader is handed exactly those (FR-056, research R-12):
 * scenario 5 reads `[orderOfA, orderOfB]` and the loader receives `orderOfA`.
 * The include is served by the probe module of `helpers/entity-extension-probe.ts`.
 */

const HOST = 'orders.Order';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const T = runToken();
const ids: string[] = [];
let foreignId = '';
let organizationA = '';
let customerA = '';
/** A colleague of `customerA` in Organization A whose *Member* role lacks `orders.view_organization`. */
let memberOfA = '';

const port = (): OrderReadPort => h.container.resolve<OrderReadPort>('orderReadPort');
const customerOfA = () => ({ customerAccountId: customerA, organizationId: organizationA });
const memberContextOfA = () => ({ customerAccountId: memberOfA, organizationId: organizationA });
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

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'orders');
  await withSystemScope('test seed: order read port extensions', async () => {
    const em = h.em();
    const orgA = await seedOrganization(em, { name: `Probe Orders A ${T}` });
    const orgB = await seedOrganization(em, { name: `Probe Orders B ${T}` });
    organizationA = orgA.id;
    const custA = await seedCustomer(em, orgA.id, { email: `probe-oa-${T}@example.com` });
    const custB = await seedCustomer(em, orgB.id, { email: `probe-ob-${T}@example.com` });
    customerA = custA.id;
    const member = await seedCustomer(em, orgA.id, { email: `probe-om-${T}@example.com` });
    await assignOrganizationRole(em, member.id, await predefinedRoleIdOf(em, orgA.id, 'member'));
    memberOfA = member.id;
    for (let index = 0; index < 50; index += 1) {
      const order = await seedOrder(em, {
        organizationId: orgA.id,
        customerId: custA.id,
        businessId: `PRB-${T}-${index.toString().padStart(2, '0')}`,
      });
      ids.push(order.id);
    }
    foreignId = (await seedOrder(em, { organizationId: orgB.id, customerId: custB.id, businessId: `PRB-${T}-B` })).id;
  });
}, 600_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

describe('OrderReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[3]!;
    const baseline = JSON.stringify(
      await asA(async () => [
        await port().findById(id),
        await port().findByIdForCustomer(id, customerOfA()),
        await port().findByIds([id]),
        await port().listAll(),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByIdForCustomer(id, customerOfA(), options),
        await port().findByIds([id], options),
        await port().listAll(options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('OrderReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByIdForCustomer, findByIds and listAll', async () => {
    const id = ids[3]!;
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      forCustomer: await port().findByIdForCustomer(id, customerOfA(), INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      all: await port().listAll(INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await asA(() => port().findById(id))), extensions: markerOf(id) });
    expect(result.forCustomer?.extensions).toEqual(markerOf(id));
    expect(result.many[0]?.extensions).toEqual(markerOf(id));
    expect(result.all.find((record) => record.id === id)?.extensions).toEqual(markerOf(id));
  });

  it('loads 50 records’ values with exactly one loader statement, on findByIds and on listAll', async () => {
    for (const read of [() => port().findByIds([...ids], INCLUDE), () => port().listAll(INCLUDE)]) {
      probe.calls.length = 0;
      const { result, statements } = await probed(read);
      expect(result).toHaveLength(50);
      expect(probeStatements(statements)).toHaveLength(1);
      expect(probe.calls).toEqual([result.map((record) => record.id)]);
      for (const record of result) expect(record.extensions).toEqual(markerOf(record.id));
    }
  });

  it('US4 scenario 5: findByIds([orderOfA, orderOfB]) under a scope of A hands the loader only orderOfA', async () => {
    probe.calls.length = 0;
    const orderOfA = ids[7]!;
    const { result, statements } = await probed(() => port().findByIds([orderOfA, foreignId], INCLUDE));
    expect(result.map((record) => record.id)).toEqual([orderOfA]);
    expect(result[0]?.extensions).toEqual(markerOf(orderOfA));
    expect(probe.calls).toEqual([[orderOfA]]);
    expect(probeStatements(statements)).toHaveLength(1);
  });

  it('runs no loader for an order out of reach: findById and findByIdForCustomer answer null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(async () => [
      await port().findById(foreignId, INCLUDE),
      await port().findByIdForCustomer(foreignId, customerOfA(), INCLUDE),
    ]);
    expect(result).toEqual([null, null]);
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('findByIdForCustomer: a colleague without orders.view_organization gets null and no loader runs', async () => {
    probe.calls.length = 0;
    const id = ids[11]!;
    const { result, statements } = await probed(() => port().findByIdForCustomer(id, memberContextOfA(), INCLUDE));
    expect(result).toBeNull();
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);

    // The same order, read by the buyer who placed it, does carry the extension.
    const own = await probed(() => port().findByIdForCustomer(id, customerOfA(), INCLUDE));
    expect(own.result?.extensions).toEqual(markerOf(id));
    expect(probe.calls).toEqual([[id]]);
    expect(probeStatements(own.statements)).toHaveLength(1);
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
