import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CustomerAccountReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runToken, seedCustomer, seedOrganization } from '../../helpers/admin-search-fixtures.js';
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

/**
 * `specs/187-side-table-extensions/` T039 (FR-054 – FR-058) —
 * `CustomerAccountReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByIds`, `searchByEmail` and `listAll`.
 *
 * The port is the composition's own (`customerAccountReadPort`). The include is
 * served by the probe module of `helpers/entity-extension-probe.ts`; without
 * it, the kernel's `entityExtensionReads` answers, and no loader in this build
 * claims `customer_accounts.CustomerAccount`.
 */

const HOST = 'customer_accounts.CustomerAccount';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const T = runToken();
const ids: string[] = [];
let organizationA = '';
let foreignId = '';

const port = (): CustomerAccountReadPort => h.container.resolve<CustomerAccountReadPort>('customerAccountReadPort');
const probed = <R>(run: () => Promise<R>) => statementsOf(h.orm, () => withProbeReads(h.container, probe, run));

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'customer_accounts');
  await withSystemScope('test seed: customer account read port extensions', async () => {
    const em = h.em();
    const organization = await seedOrganization(em, { name: `Probe Accounts ${T}` });
    organizationA = organization.id;
    const other = await seedOrganization(em, { name: `Probe Accounts B ${T}` });
    foreignId = (await seedCustomer(em, other.id, { email: `probe-${T}-foreign@example.com` })).id;
    for (let index = 0; index < 50; index += 1) {
      const account = await seedCustomer(em, organization.id, {
        email: `probe-${T}-${index.toString().padStart(2, '0')}@example.com`,
      });
      ids.push(account.id);
    }
  });
}, 600_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

describe('CustomerAccountReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[7]!;
    const email = `probe-${T}-07@example.com`;
    const baseline = JSON.stringify([
      await port().findById(id),
      (await port().findByIds([id]))[0],
      (await port().searchByEmail(email, 5))[0],
    ]);
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        (await port().findByIds([id], options))[0],
        (await port().searchByEmail(email, 5, options))[0],
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('CustomerAccountReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByIds, searchByEmail and listAll', async () => {
    const id = ids[7]!;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      searched: await port().searchByEmail(`probe-${T}-07@example.com`, 5, INCLUDE),
      all: await port().listAll(INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await port().findById(id)), extensions: value });
    expect(result.many[0]?.extensions).toEqual(value);
    expect(result.searched[0]?.extensions).toEqual(value);
    expect(result.all.find((record) => record.id === id)?.extensions).toEqual(value);
    expect(result.all.every((record) => record.extensions !== undefined)).toBe(true);
  });

  it('keeps the lookup options beside include', async () => {
    const { result } = await probed(() => port().findById(ids[7]!, { activeOnly: true, ...INCLUDE }));
    expect(result?.extensions).toEqual({ acme_probe: { marker: `probe:${ids[7]}` } });
  });

  it('loads 50 records’ values with exactly one loader statement, handed the ids in record order', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().findByIds(ids, INCLUDE));
    expect(result).toHaveLength(50);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(new Set(probe.calls[0])).toEqual(new Set(ids));
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const { result, statements } = await probed(() => port().findById(ids[7]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await port().findById(ids[7]!)));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    // The kernel's own reads service: nothing in this build extends the host.
    const error = await port()
      .findById(ids[7]!, INCLUDE)
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
    const viaProbe = await probed(() =>
      port()
        .findByIds(ids, { include: ['extensions.acme_probe', 'extensions.nobody_here'] })
        .catch((thrown: unknown) => thrown),
    );
    expect(viaProbe.result).toMatchObject({ statusCode: 422, code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED });
    expect(probeStatements(viaProbe.statements)).toEqual([]);
  });
});

/**
 * Review of #1991 (issue #1992): the loader is the only tenant guard a side
 * table has (#1980), so it must never be handed an id the caller may not read.
 * An administrator confined to Organization A asks for A's accounts and one of
 * B's.
 */
describe('CustomerAccountReadPort with include, across tenants (XI)', () => {
  const asA = <R>(body: () => Promise<R>): Promise<R> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId: randomUUID() },
        { allowAll: false, allowedOrganizationIds: [organizationA] },
      ),
      body,
    );
  const probedAsA = <R>(run: () => Promise<R>) =>
    statementsOf(h.orm, () => withProbeReads(h.container, probe, () => asA(run)));

  it('hands the loader only the ids the caller may read', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probedAsA(() => port().findByIds([...ids, foreignId], INCLUDE));
    expect(result.map((record) => record.id)).not.toContain(foreignId);
    expect(result).toHaveLength(50);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]).not.toContain(foreignId);
  });

  it('runs no loader for an account out of reach: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probedAsA(() => port().findById(foreignId, INCLUDE));
    expect(result).toBeNull();
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });
});
