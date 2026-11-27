import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CatalogCategoryReadPort } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  entityExtensionProbe,
  probeStatements,
  statementsOf,
  withProbeReads,
  type EntityExtensionProbe,
} from '../../helpers/entity-extension-probe.js';
import { Category } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/187-side-table-extensions/` T043 (FR-054 – FR-058) —
 * `CatalogCategoryReadPort` with `include`, `contracts/extension-attributes-read-ports.md`
 * §3 – §4: `findById`, `findByIds`, `findBySlug`, `listAll` and `ancestorsOf`.
 *
 * The port is the composition's own (`catalogCategoryReadPort`). `Category` is
 * a `@GlobalEntity` and the port applies no channel policy — its scope is the
 * lookup's own `liveOnly`; channel membership (Principle XII) is the caller's,
 * resolved before it names an id. What this holds is that the loader is handed
 * exactly the categories the port answered: a soft-deleted category `liveOnly`
 * excludes never reaches it (FR-056, research R-12).
 *
 * The fixture is a chain of 50 categories, each the child of the one before,
 * plus one soft-deleted category.
 */

const HOST = 'catalog.Category';
const INCLUDE = { include: ['extensions.acme_probe'] as const };

let h: BackendServerHandle;
let probe: EntityExtensionProbe;
const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
/** Root first; `chain[49]` is the deepest. */
const chain: string[] = [];
const slugOf = (index: number): string => `prb-${stamp}-${index.toString().padStart(2, '0')}`;
let deletedId = '';

const port = (): CatalogCategoryReadPort => h.container.resolve<CatalogCategoryReadPort>('catalogCategoryReadPort');
const asAdmin = <R>(body: () => Promise<R>): Promise<R> =>
  runWithTenantContext(
    resolveTenantContext({ kind: 'admin', adminUserId: randomUUID() }, { allowAll: true, allowedOrganizationIds: [] }),
    body,
  );
const probed = <R>(run: () => Promise<R>) => statementsOf(h.orm, () => withProbeReads(h.container, probe, () => asAdmin(run)));

beforeAll(async () => {
  h = await setupBackendServer();
  probe = entityExtensionProbe(HOST, 'categories');
  const em = h.em().fork();
  let parent: string | null = null;
  for (let index = 0; index < 50; index += 1) {
    const category = em.create(Category, {
      name: { en: slugOf(index) },
      slug: slugOf(index),
      parentCategoryId: parent,
    } as never) as { id: string };
    em.persist(category);
    chain.push(category.id);
    parent = category.id;
  }
  const deleted = em.create(Category, {
    name: { en: `prb-${stamp}-del` },
    slug: `prb-${stamp}-del`,
    deletedAt: new Date(),
  } as never) as { id: string };
  em.persist(deleted);
  deletedId = deleted.id;
  await em.flush();
}, 600_000);

afterAll(async () => {
  await h.em().getConnection().execute(`delete from "categories" where "slug" like ?`, [`prb-${stamp}-%`]);
  await teardownBackendServer(h);
});

describe('CatalogCategoryReadPort without include (FR-055)', () => {
  it('answers byte-identically to the call without options, with no extensions key and no loader', async () => {
    const id = chain[3]!;
    const baseline = JSON.stringify(
      await asAdmin(async () => [
        await port().findById(id),
        await port().findByIds([id]),
        await port().findBySlug(slugOf(3)),
        await port().ancestorsOf(id),
      ]),
    );
    expect(baseline).not.toContain('extensions');
    for (const options of [{}, { include: [] }]) {
      const { result, statements } = await probed(async () => [
        await port().findById(id, options),
        await port().findByIds([id], options),
        await port().findBySlug(slugOf(3), options),
        await port().ancestorsOf(id, options),
      ]);
      expect(JSON.stringify(result)).toBe(baseline);
      expect(probeStatements(statements)).toEqual([]);
    }
    const { statements } = await probed(() => port().listAll({ liveOnly: true, include: [] }));
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });
});

describe('CatalogCategoryReadPort with include (FR-054, FR-056)', () => {
  it('attaches extensions.acme_probe on findById, findByIds, findBySlug, listAll and ancestorsOf', async () => {
    const id = chain[3]!;
    const value = { acme_probe: { marker: `probe:${id}` } };
    const { result } = await probed(async () => ({
      one: await port().findById(id, INCLUDE),
      many: await port().findByIds([id], INCLUDE),
      bySlug: await port().findBySlug(slugOf(3), INCLUDE),
      all: await port().listAll({ liveOnly: true, ...INCLUDE }),
      ancestors: await port().ancestorsOf(id, INCLUDE),
    }));
    expect(result.one).toEqual({ ...(await asAdmin(() => port().findById(id))), extensions: value });
    expect(result.many[0]?.extensions).toEqual(value);
    expect(result.bySlug?.extensions).toEqual(value);
    expect(result.all.find((record) => record.id === id)?.extensions).toEqual(value);
    expect(result.ancestors.map((record) => record.extensions)).toEqual(
      [3, 2, 1, 0].map((index) => ({ acme_probe: { marker: `probe:${chain[index]}` } })),
    );
  });

  it('loads 50 records’ values with exactly one loader statement, handed only the ids the lookup answered', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() =>
      port().findByIds([...chain, deletedId, randomUUID()], { liveOnly: true, ...INCLUDE }),
    );
    expect(result).toHaveLength(50);
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toHaveLength(1);
    expect([...probe.calls[0]!].sort()).toEqual([...chain].sort());
    expect(probe.calls[0]).not.toContain(deletedId);
    for (const record of result) expect(record.extensions).toEqual({ acme_probe: { marker: `probe:${record.id}` } });
  });

  it('ancestorsOf a 50-deep chain hands the whole chain to one loader statement, nearest first', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().ancestorsOf(chain[49]!, INCLUDE));
    expect(result.map((record) => record.id)).toEqual([...chain].reverse());
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([[...chain].reverse()]);
  });

  it('listAll(liveOnly) hands the loader the live tree in one statement, never a soft-deleted category', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(() => port().listAll({ liveOnly: true, ...INCLUDE }));
    expect(probeStatements(statements)).toHaveLength(1);
    expect(probe.calls).toEqual([result.map((record) => record.id)]);
    expect(probe.calls[0]).toEqual(expect.arrayContaining(chain));
    expect(probe.calls[0]).not.toContain(deletedId);
  });

  it('runs no loader for a category out of the lookup’s scope: findById answers null', async () => {
    probe.calls.length = 0;
    const { result, statements } = await probed(async () => [
      await port().findById(deletedId, { liveOnly: true, ...INCLUDE }),
      await port().findById(randomUUID(), INCLUDE),
      await port().findBySlug(`prb-${stamp}-missing`, INCLUDE),
    ]);
    expect(result).toEqual([null, null, null]);
    expect(probeStatements(statements)).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('omits the key and runs no loader while the extending module is absent', async () => {
    probe.present = false;
    try {
      const { result, statements } = await probed(() => port().findById(chain[3]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await asAdmin(() => port().findById(chain[3]!))));
      expect(probeStatements(statements)).toEqual([]);
    } finally {
      probe.present = true;
    }
  });

  it('refuses an include no loader of the composition claims: 422 ENTITY_EXTENSION_UNCLAIMED', async () => {
    const error = await asAdmin(() => port().findById(chain[3]!, INCLUDE)).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.acme_probe', issue: 'unclaimed' }],
    });
  });
});
