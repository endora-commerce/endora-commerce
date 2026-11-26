import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type QuoteRequestReadPort } from '@endora-commerce/contracts';
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
import { QuoteRequest } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T041 (FR-054 – FR-058) —
 * `QuoteRequestReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByBusinessId` and `findByIds`.
 *
 * The port is the composition's own (`quoteRequestReadPort`), called under an
 * administrator's context reaching one Organization. The include is served by
 * the probe module of `helpers/entity-extension-probe.ts`; the loader is handed
 * only the quotes that context may read (FR-056, research R-12).
 */

const HOST = 'quote_requests.QuoteRequest';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const T = runToken();
const ids: string[] = [];
let foreignId = '';
let organizationA = '';

const port = (): QuoteRequestReadPort => h.container.resolve<QuoteRequestReadPort>('quoteRequestReadPort');
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

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'quote_requests');
  await withSystemScope('test seed: quote request read port extensions', async () => {
    const em = h.em();
    const orgA = await seedOrganization(em, { name: `Probe Quotes A ${T}` });
    const orgB = await seedOrganization(em, { name: `Probe Quotes B ${T}` });
    organizationA = orgA.id;
    const custA = await seedCustomer(em, orgA.id, { email: `probe-qa-${T}@example.com` });
    const custB = await seedCustomer(em, orgB.id, { email: `probe-qb-${T}@example.com` });
    for (let index = 0; index < 50; index += 1) {
      const row = em.create(QuoteRequest, {
        organizationId: orgA.id,
        customerAccountId: custA.id,
        businessId: `PROBE-${T}-${index.toString().padStart(2, '0')}`,
      } as never);
      em.persist(row);
      ids.push((row as { id: string }).id);
    }
    const foreign = em.create(QuoteRequest, {
      organizationId: orgB.id,
      customerAccountId: custB.id,
      businessId: `PROBE-${T}-B`,
    } as never);
    em.persist(foreign);
    await em.flush();
    foreignId = (foreign as { id: string }).id;
  });
}, 600_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

describe('QuoteRequestReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[3]!;
    const businessId = `PROBE-${T}-03`;
    const baseline = JSON.stringify(
      await asA(async () => [await port().findById(id), await port().findByBusinessId(businessId), await port().findByIds([id])]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByBusinessId(businessId, options),
        await port().findByIds([id], options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    expect(probe.calls).toEqual([]);
  });
});

describe('QuoteRequestReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByBusinessId and findByIds', async () => {
    const id = ids[3]!;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      byBusinessId: await port().findByBusinessId(`PROBE-${T}-03`, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await asA(() => port().findById(id))), extensions: value });
    expect(result.byBusinessId?.extensions).toEqual(value);
    expect(result.many[0]?.extensions).toEqual(value);
  });

  it('loads 50 records’ values with exactly one loader statement, handed only the ids the caller may read', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().findByIds([...ids, foreignId], INCLUDE));
    expect(result).toHaveLength(50);
    expect(result.map((record) => record.id)).not.toContain(foreignId);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).not.toContain(foreignId);
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
  });

  it('runs no loader for a quote out of reach: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().findById(foreignId, INCLUDE));
    expect(result).toBeNull();
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
