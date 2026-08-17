import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogProductFilter } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CatalogProductFilterService } from '../../../src/modules/catalog/services/catalog-product-filter.service.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * Feature 075 — `catalogProductFilterPort`, the answer to the one demand Phase P
 * declined to guess at.
 *
 * The port exists so `product_feeds` can stop compiling its selection rule into
 * a MikroORM `where` object and handing it to `em.find(Product, where as never)`
 * across a module boundary. What it therefore has to prove is not "a filter
 * filters" but the three properties the caller gave up when it stopped composing
 * the query itself:
 *
 *  1. **The sellable floor cannot be widened.** A filter that asks for a
 *     draft, a private, an archived or a soft-deleted product gets nothing —
 *     the floor is conjoined by the owner, after the caller's filter.
 *  2. **The page is a keyset.** Ascending id, `afterId` strictly greater, so a
 *     catalogue that moves under a long walk cannot make it skip or repeat.
 *  3. **An `or` branch that constrains nothing still matches everything.** That
 *     is the one place an empty predicate is not neutral, and getting it wrong
 *     turns the SQL stage from a superset into a subset — a feed quietly
 *     dropping products it was configured to carry.
 */

const SET_ID = 'defa0017-0000-4000-8000-000000000000';

describe('catalogProductFilterPort — the sellable selection scan [integration]', () => {
  let db: TestDb;
  let em: EntityManager;
  let port: CatalogProductFilterService;
  let ids: Record<string, string>;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    port = new CatalogProductFilterService(() => em);
    ids = await seedProducts(em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  const all = (): string[] => Object.values(ids);

  it('returns only sellable products, whatever the filter asks for', async () => {
    // The filter deliberately asks for every status and every visibility the
    // seed carries. The floor is what decides, and it is not the caller's.
    const filter: CatalogProductFilter = { kind: 'all' };
    const rows = await port.listSellable({ productIds: all(), filter });

    expect(rows.map((row) => row.id)).toEqual([ids['active']!, ids['second']!].sort());
  });

  it('refuses to be widened by a filter that names a non-sellable row', async () => {
    const filter: CatalogProductFilter = {
      kind: 'group',
      op: 'or',
      children: [
        { kind: 'condition', field: { kind: 'column', column: 'status' }, op: 'eq', values: ['draft'] },
        { kind: 'condition', field: { kind: 'column', column: 'id' }, op: 'in', values: [ids['deleted']!, ids['archived']!, ids['private']!] },
      ],
    };

    expect(await port.listSellable({ productIds: all(), filter })).toEqual([]);
    expect(await port.countSellable({ productIds: all(), filter })).toBe(0);
  });

  it('never looks outside the ids it was given', async () => {
    const filter: CatalogProductFilter = { kind: 'all' };

    expect(await port.listSellable({ productIds: [], filter })).toEqual([]);
    expect(await port.countSellable({ productIds: [], filter })).toBe(0);
    expect(
      (await port.listSellable({ productIds: [ids['second']!], filter })).map((row) => row.id),
    ).toEqual([ids['second']!]);
  });

  it('pages by keyset, ascending, strictly after the cursor', async () => {
    const filter: CatalogProductFilter = { kind: 'all' };
    const first = await port.listSellable({ productIds: all(), filter, limit: 1 });
    expect(first).toHaveLength(1);

    const second = await port.listSellable({
      productIds: all(),
      filter,
      afterId: first[0]!.id,
      limit: 10,
    });
    expect(second.map((row) => row.id)).not.toContain(first[0]!.id);
    expect([first[0]!.id, ...second.map((row) => row.id)]).toEqual(
      [ids['active']!, ids['second']!].sort(),
    );
  });

  it('matches on a column, on the attribute bag, and on a range built from two conditions', async () => {
    const bySku: CatalogProductFilter = {
      kind: 'condition',
      field: { kind: 'column', column: 'sku' },
      op: 'startsWith',
      values: ['FILTER-ACTIVE'],
    };
    expect((await port.listSellable({ productIds: all(), filter: bySku })).map((r) => r.sku)).toEqual([
      'FILTER-ACTIVE',
    ]);

    const byAttribute: CatalogProductFilter = {
      kind: 'condition',
      field: { kind: 'attribute', key: 'colour' },
      op: 'in',
      values: ['teal', 'ochre'],
    };
    expect(
      (await port.listSellable({ productIds: all(), filter: byAttribute })).map((r) => r.id).sort(),
    ).toEqual([ids['active']!, ids['second']!].sort());

    const created = (await em.findOne(Product, { id: ids['active']! }))!.createdAt;
    const range: CatalogProductFilter = {
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'condition', field: { kind: 'column', column: 'createdAt' }, op: 'gte', values: [created] },
        { kind: 'condition', field: { kind: 'column', column: 'createdAt' }, op: 'lte', values: [created] },
      ],
    };
    expect(await port.countSellable({ productIds: [ids['active']!], filter: range })).toBe(1);
  });

  it('treats an `all` branch of an `or` as matching everything, not as collapsing the branch', async () => {
    // The regression this guards: an empty predicate inside `$or` removes the
    // branch, so a rule reading "matches nothing in particular OR is teal"
    // would return only the teal rows — the SQL stage narrower than the rule.
    const filter: CatalogProductFilter = {
      kind: 'group',
      op: 'or',
      children: [
        { kind: 'all' },
        { kind: 'condition', field: { kind: 'attribute', key: 'colour' }, op: 'eq', values: ['teal'] },
      ],
    };

    expect((await port.listSellable({ productIds: all(), filter })).map((r) => r.id).sort()).toEqual(
      [ids['active']!, ids['second']!].sort(),
    );
  });

  it('selects nothing for `none`, and nothing for an operator given no value', async () => {
    expect(await port.countSellable({ productIds: all(), filter: { kind: 'none' } })).toBe(0);

    const halfFilled: CatalogProductFilter = {
      kind: 'condition',
      field: { kind: 'column', column: 'status' },
      op: 'eq',
      values: [],
    };
    expect(await port.countSellable({ productIds: all(), filter: halfFilled })).toBe(0);
  });
});

async function seedProducts(em: EntityManager): Promise<Record<string, string>> {
  const base = {
    type: 'simple' as const,
    description: {},
    attributeSetId: SET_ID,
    attributeValues: {},
  };
  const rows = {
    active: em.create(Product, {
      ...base,
      sku: 'FILTER-ACTIVE',
      slug: 'filter-active',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'Active' },
      attributeValues: { colour: 'teal' },
    }),
    second: em.create(Product, {
      ...base,
      sku: 'FILTER-SECOND',
      slug: 'filter-second',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'Second' },
      attributeValues: { colour: 'ochre' },
    }),
    draft: em.create(Product, {
      ...base,
      sku: 'FILTER-DRAFT',
      slug: 'filter-draft',
      status: 'draft',
      visibility: 'public',
      name: { 'en-US': 'Draft' },
    }),
    private: em.create(Product, {
      ...base,
      sku: 'FILTER-PRIVATE',
      slug: 'filter-private',
      status: 'active',
      visibility: 'logged_in_only',
      name: { 'en-US': 'Private' },
    }),
    archived: em.create(Product, {
      ...base,
      sku: 'FILTER-ARCHIVED',
      slug: 'filter-archived',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'Archived' },
      archivedAt: new Date(),
    }),
    deleted: em.create(Product, {
      ...base,
      sku: 'FILTER-DELETED',
      slug: 'filter-deleted',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'Deleted' },
      deletedAt: new Date(),
    }),
  };
  await em.persistAndFlush(Object.values(rows));
  return Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.id]));
}
