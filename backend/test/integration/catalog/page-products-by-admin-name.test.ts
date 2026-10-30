import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product, ProductVariant } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-product-read.service.js';
import { seedBulkProductsSql } from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 redesign (`research.md` R14) — `catalogProductReadPort.pageProductsByAdminName`:
 * one page of the products a caller's **membership seam** names (a subquery the
 * caller owns, embedded by the catalogue as a hashed probe), ordered by the
 * stored admin name key of the admin language, then SKU, then id, with the
 * total; narrowed by a search over the stored search key (name and SKU) or a
 * variant's SKU. `en` and `pl` have keys; any other language reads `en`.
 *
 * Two strategies answer a search — the trigram hits sorted (few matches) or
 * the ordered index walk (many) — and they must answer identical pages, which
 * the two services below force (`sparseSearchLimit` 0 and unbounded).
 */
describe('CatalogProductReadService.pageProductsByAdminName (161 G15)', () => {
  let h: BackendServerHandle;
  let port: CatalogProductReadService;
  let dense: CatalogProductReadService;
  let sparse: CatalogProductReadService;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: Record<string, string> = {};
  let membership: { sql: string; params: unknown[] };

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new CatalogProductReadService(h.em);
    dense = new CatalogProductReadService(h.em, { sparseSearchLimit: 0 });
    sparse = new CatalogProductReadService(h.em, { sparseSearchLimit: Number.MAX_SAFE_INTEGER });
    const em = h.em();
    const make = (key: string, sku: string, name: Record<string, string>, extra: Record<string, unknown> = {}) => {
      const p = em.create(Product, {
        sku: `${sku}-${stamp}`,
        slug: `g15n-${key.toLowerCase()}-${stamp.toLowerCase()}`,
        type: 'simple',
        status: 'active',
        name,
        description: '',
        visibility: 'public',
        attributeValues: {},
        ...extra,
      });
      ids[key] = p.id;
      return p;
    };
    await em.persistAndFlush([
      make('anchor', 'G15N-A', { 'en-US': 'Anchor' }),
      make('bolt2', 'G15N-B2', { 'en-US': 'Bolt' }),
      make('bolt1', 'G15N-B1', { 'en-US': 'Bolt' }),
      make('brick', 'G15N-C', { 'pl-PL': 'Wkręt', 'en-US': 'Brick' }),
      make('lacznik', 'G15N-L', { 'pl-PL': 'Łącznik' }),
      make('empty', 'G15N-E', {}),
      make('gone', 'G15N-F', { 'en-US': 'Fastener' }, { deletedAt: new Date(), status: 'inactive' }),
      make('outside', 'G15N-O', { 'en-US': 'Aardvark' }),
    ]);
    await em.persistAndFlush(em.create(ProductVariant, { parentProductId: ids['anchor']!, sku: `G15N-AV-${stamp}`, variantAttributeValues: {} }));
    const members = Object.entries(ids).filter(([k]) => k !== 'outside').map(([, id]) => id);
    membership = { sql: 'select m.id from unnest(?::uuid[]) as m(id)', params: [`{${members.join(',')}}`] };
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const page = (svc: CatalogProductReadService, query: { language: string | null; search?: string; offset?: number; limit?: number }) =>
    svc.pageProductsByAdminName({ membership, language: query.language, ...(query.search ? { search: query.search } : {}), offset: query.offset ?? 0, limit: query.limit ?? 50 });

  it('orders the members by the English key, then SKU, with the total; non-members absent', async () => {
    const answer = await page(port, { language: 'en' });
    expect(answer.total).toBe(7);
    // anchor, bolt (B1), bolt (B2), brick, fastener (soft-deleted, listed), g15n-e-… (no name: its SKU),
    // then the Polish-only product (`lacznik` above), whose name falls back to Polish and folds to "lacznik"
    expect(answer.ids).toEqual([ids['anchor'], ids['bolt1'], ids['bolt2'], ids['brick'], ids['gone'], ids['empty'], ids['lacznik']]);
  });

  it('orders by the Polish key for pl, and an unknown language reads en', async () => {
    expect((await page(port, { language: 'pl' })).ids).toEqual([
      ids['anchor'],
      ids['bolt1'],
      ids['bolt2'],
      ids['gone'],
      ids['empty'],
      ids['lacznik'],
      ids['brick'],
    ]);
    expect((await page(port, { language: 'de' })).ids).toEqual((await page(port, { language: 'en' })).ids);
    expect((await page(port, { language: null })).ids).toEqual((await page(port, { language: 'en' })).ids);
  });

  it('pages by offset and limit, the total unchanged', async () => {
    const all = (await page(port, { language: 'en' })).ids;
    const pages = await Promise.all([0, 3, 6].map((offset) => page(port, { language: 'en', offset, limit: 3 })));
    expect(pages.map((p) => p.total)).toEqual([7, 7, 7]);
    expect(pages.flatMap((p) => p.ids)).toEqual(all);
  });

  it('searches the name, the SKU and a variant’s SKU, folded and literally', async () => {
    expect(await page(port, { language: 'en', search: 'BOLT' })).toEqual({ ids: [ids['bolt1'], ids['bolt2']], total: 2 });
    expect((await page(port, { language: 'en', search: `g15n-c-${stamp}` })).ids).toEqual([ids['brick']]);
    expect((await page(port, { language: 'en', search: 'G15N-AV' })).ids).toEqual([ids['anchor']]);
    expect((await page(port, { language: 'pl', search: 'łącz' })).ids).toEqual([ids['lacznik']]);
    expect((await page(port, { language: 'pl', search: 'lacz' })).ids).toEqual([ids['lacznik']]);
    expect((await page(port, { language: 'en', search: 'aardvark' })).total).toBe(0);
    expect((await page(port, { language: 'en', search: '%' })).total).toBe(0);
  });

  it('the sparse and dense strategies answer identical pages', async () => {
    for (const search of ['g15n', 'bo', 'a', 'G15N-AV', 'zz']) {
      for (const [offset, limit] of [
        [0, 50],
        [1, 2],
        [5, 50],
      ] as const) {
        const query = { language: 'en', search, offset, limit };
        expect(await page(dense, query), `${search} ${offset}`).toEqual(await page(sparse, query));
      }
    }
  });

  /**
   * The ordered walk at a deep offset (Checkpoint 2b): on a freshly
   * bulk-inserted, never-analysed table the planner prices the index walk
   * above a sort of every member (`research.md` R14 follow-up), so the page
   * statement runs with `set local enable_sort = off` — and must still answer
   * exactly the sparse strategy's page, with and without a search.
   */
  it('the dense walk answers the sparse pages at a deep offset, on unanalysed bulk data', async () => {
    const bulk = await seedBulkProductsSql(h.em(), { count: 3000, namePrefix: `Deep ${stamp}`, skuPrefix: `G15W-${stamp}`, words: ['Screw', 'Bolt', 'Nut'] });
    const deep = { sql: 'select m.id from unnest(?::uuid[]) as m(id)', params: [`{${bulk.join(',')}}`] };
    const at = (svc: CatalogProductReadService, search: string | undefined, offset: number) =>
      svc.pageProductsByAdminName({ membership: deep, language: 'en', ...(search ? { search } : {}), offset, limit: 100 });
    for (const [search, offset] of [
      [undefined, 2900],
      [undefined, 1500],
      ['deep', 2900],
      ['screw', 900],
    ] as const) {
      expect(await at(dense, search, offset), `${search} ${offset}`).toEqual(await at(sparse, search, offset));
    }
    const all = await at(port, undefined, 2950);
    expect(all.total).toBe(3000);
    expect(all.ids).toHaveLength(50);
  });

  it('runs the ordered page with the sort disabled, so the walk does not depend on statistics', async () => {
    const conn = h.em().getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = conn.execute.bind(conn);
    const seen: string[] = [];
    conn.execute = (...args: unknown[]) => {
      seen.push(String(args[0]).replace(/\s+/g, ' ').trim());
      return original(...args);
    };
    try {
      await dense.pageProductsByAdminName({ membership, language: 'en', search: 'g15n', offset: 1, limit: 2 });
      await port.pageProductsByAdminName({ membership, language: 'en', offset: 1, limit: 2 });
    } finally {
      conn.execute = original;
    }
    const pages = seen.map((sql, i) => ({ sql, i })).filter(({ sql }) => /order by (p\."admin_name_key_en"|h\."k")/.test(sql));
    expect(pages).toHaveLength(2);
    expect(pages.map(({ i }) => seen[i - 1])).toEqual(['set local enable_sort = off', 'set local enable_sort = off']);
  });
});
