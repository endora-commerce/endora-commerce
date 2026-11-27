import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CatalogProductReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T042 (FR-054 – FR-058) —
 * `CatalogProductReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByIds`, `findBySku`, `findBySkus` and `listAll`.
 *
 * The port is the composition's own (`catalogProductReadPort`). `Product` is a
 * `@GlobalEntity` and the port applies no channel or buyer policy — its scope is
 * the lookup's own narrowing (`liveOnly`, `activeOnly`); a storefront caller
 * resolves channel visibility (Principle XII) before it names an id. What this
 * holds is that the loader is handed exactly the products the port answered: a
 * soft-deleted or inactive product the narrowing excludes never reaches it
 * (FR-056, research R-12).
 */

const HOST = 'catalog.Product';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
const ids: string[] = [];
const skus: string[] = [];
let deletedId = '';
let inactiveId = '';

const port = (): CatalogProductReadPort => h.container.resolve<CatalogProductReadPort>('catalogProductReadPort');
const asAdmin = <R>(body: () => Promise<R>): Promise<R> =>
  runWithTenantContext(
    resolveTenantContext({ kind: 'admin', adminUserId: randomUUID() }, { allowAll: true, allowedOrganizationIds: [] }),
    body,
  );
const probed = <R>(run: () => Promise<R>) => statementsOf(h.orm, () => withProbeReads(h.container, probe, () => asAdmin(run)));

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'products');
  const em = h.em().fork();
  const make = (sku: string, extra: Record<string, unknown> = {}) => {
    const product = em.create(Product, {
      sku,
      slug: sku.toLowerCase(),
      type: 'simple',
      status: 'active',
      name: sku,
      description: sku,
      visibility: 'public',
      allowedOrganizationIds: [],
      attributeValues: {},
      ...extra,
    } as never);
    em.persist(product);
    return (product as { id: string }).id;
  };
  for (let index = 0; index < 50; index += 1) {
    const sku = `PRB-${stamp}-${index.toString().padStart(2, '0')}`;
    skus.push(sku);
    ids.push(make(sku));
  }
  deletedId = make(`PRB-${stamp}-DEL`, { deletedAt: new Date() });
  inactiveId = make(`PRB-${stamp}-OFF`, { status: 'inactive' });
  await em.flush();
}, 600_000);

afterAll(async () => {
  await h.em().getConnection().execute(`delete from "products" where "sku" like ?`, [`PRB-${stamp}-%`]);
  await teardownBackendServer(h);
});

describe('CatalogProductReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = ids[3]!;
    const sku = skus[3]!;
    const baseline = JSON.stringify(
      await asAdmin(async () => [
        await port().findById(id),
        await port().findByIds([id]),
        await port().findBySku(sku),
        await port().findBySkus([sku]),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }, { liveOnly: true }, { liveOnly: true, include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByIds([id], options),
        await port().findBySku(sku, options),
        await port().findBySkus([sku], options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    const { statements } = await probed(() => port().listAll({ include: [] }));
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });
});

describe('CatalogProductReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByIds, findBySku, findBySkus and listAll', async () => {
    const id = ids[3]!;
    const sku = skus[3]!;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      bySku: await port().findBySku(sku, INCLUDE),
      bySkus: await port().findBySkus([sku], INCLUDE),
      all: await port().listAll({ liveOnly: true, ...INCLUDE }),
    }));
    expect(result.one).toEqual({ ...(await asAdmin(() => port().findById(id))), extensions: value });
    expect(result.many[0]?.extensions).toEqual(value);
    expect(result.bySku?.extensions).toEqual(value);
    expect(result.bySkus[0]?.extensions).toEqual(value);
    expect(result.all.find((record) => record.id === id)?.extensions).toEqual(value);
  });

  it('loads 50 records’ values with exactly one loader statement, handed only the ids the lookup answered', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() =>
      port().findByIds([...ids, deletedId, inactiveId, randomUUID()], { activeOnly: true, ...INCLUDE }),
    );
    expect(result).toHaveLength(50);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toHaveLength(1);
    expect([...probe.calls[0]!].sort()).toEqual([...ids].sort());
    expect(probe.calls[0]).not.toContain(deletedId);
    expect(probe.calls[0]).not.toContain(inactiveId);
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
  });

  it('listAll hands the loader the whole live catalogue in one statement, never a soft-deleted product', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().listAll({ liveOnly: true, ...INCLUDE }));
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).not.toContain(deletedId);
    expect(probe.calls[0]).toContain(inactiveId);
  });

  it('runs no loader for a product out of the lookup’s scope: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(async () => [
      await port().findById(deletedId, { liveOnly: true, ...INCLUDE }),
      await port().findById(inactiveId, { activeOnly: true, ...INCLUDE }),
      await port().findBySku(`PRB-${stamp}-DEL`, { liveOnly: true, ...INCLUDE }),
    ]);
    expect(result).toEqual([null, null, null]);
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const { result, statements } = await probed(() => port().findById(ids[3]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await asAdmin(() => port().findById(ids[3]!))));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    const error = await asAdmin(() => port().findById(ids[3]!, INCLUDE)).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
  });
});
