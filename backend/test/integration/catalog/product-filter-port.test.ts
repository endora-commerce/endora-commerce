import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  isProductVisibleTo,
  productVisibilitySchema,
  type CatalogProductFilter,
  type ProductVisibility,
} from '@b2b/contracts';
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

  /**
   * Issue #181. `contains` and `startsWith` name a **literal**, so `%`, `_` and
   * the escape character are characters in the value and not wildcards.
   *
   * The pattern used to be built as `%${value}%` with nothing escaped, which is
   * both wider and narrower than the operator says: `contains "50%"` matched
   * every sku with "50" followed by anything, while `contains "C\\D"` matched
   * `CD` and missed the sku that actually holds the backslash — PostgreSQL's
   * default LIKE escape is `\\`, and it degrades an escape sequence it does not
   * recognise to the plain character.
   *
   * Each case seeds the row the operator names **and a decoy** the unescaped
   * pattern used to pick up, so a regression cannot pass by matching nothing.
   */
  describe('matches the value of `contains` and `startsWith` literally', () => {
    const matchingSkus = async (
      seeded: Record<string, string>,
      op: 'contains' | 'startsWith',
      value: string,
    ): Promise<string[]> => {
      const rows = await port.listSellable({
        productIds: Object.values(seeded),
        filter: { kind: 'condition', field: { kind: 'column', column: 'sku' }, op, values: [value] },
      });
      return rows.map((row) => row.sku).sort();
    };

    it('treats `%` in the value as a character, not as "anything"', async () => {
      const seeded = await seedSkus(em, ['LIT-50%-OFF', 'LIT-500-OFF']);

      expect(await matchingSkus(seeded, 'contains', '50%')).toEqual(['LIT-50%-OFF']);
      expect(await matchingSkus(seeded, 'startsWith', 'LIT-50%')).toEqual(['LIT-50%-OFF']);
    });

    it('treats `_` in the value as a character, not as "any one character"', async () => {
      const seeded = await seedSkus(em, ['LIT-A_B', 'LIT-AXB']);

      expect(await matchingSkus(seeded, 'contains', 'A_B')).toEqual(['LIT-A_B']);
      expect(await matchingSkus(seeded, 'startsWith', 'LIT-A_')).toEqual(['LIT-A_B']);
    });

    it('treats the escape character in the value as a character, not as an escape', async () => {
      const seeded = await seedSkus(em, ['LIT-C\\D', 'LIT-CD']);

      expect(await matchingSkus(seeded, 'contains', 'C\\D')).toEqual(['LIT-C\\D']);
      expect(await matchingSkus(seeded, 'startsWith', 'LIT-C\\')).toEqual(['LIT-C\\D']);
    });

    it('escapes the value on the attribute bag as well as on a column', async () => {
      // The JSONB path builds the same pattern, so it is the same defect and
      // has to be the same fix; a column-only escape leaves half the grammar
      // matching more than it says.
      const seeded = await seedSkus(em, ['LIT-ATTR-LITERAL', 'LIT-ATTR-DECOY'], {
        'LIT-ATTR-LITERAL': { code: '50%' },
        'LIT-ATTR-DECOY': { code: '500' },
      });

      const rows = await port.listSellable({
        productIds: Object.values(seeded),
        filter: {
          kind: 'condition',
          field: { kind: 'attribute', key: 'code' },
          op: 'contains',
          values: ['50%'],
        },
      });
      expect(rows.map((row) => row.sku)).toEqual(['LIT-ATTR-LITERAL']);
    });

    it('still matches an ordinary value exactly as it did before', async () => {
      const seeded = await seedSkus(em, ['LIT-PLAIN-ONE', 'LIT-PLAIN-TWO', 'LIT-OTHER']);

      expect(await matchingSkus(seeded, 'contains', 'PLAIN')).toEqual([
        'LIT-PLAIN-ONE',
        'LIT-PLAIN-TWO',
      ]);
      expect(await matchingSkus(seeded, 'startsWith', 'LIT-PLAIN-T')).toEqual(['LIT-PLAIN-TWO']);
    });
  });

  /**
   * The audience half of the floor, and the parity that keeps it honest
   * (issue #259).
   *
   * A product feed is read by Google — an anonymous, unauthenticated consumer —
   * so the audience this port answers for is
   * {@link ANONYMOUS_PRODUCT_AUDIENCE}, exactly as the sitemap's is. The floor
   * said `visibility = 'public'` and stopped, which is not the whole answer: an
   * operator can save `public` **with** a non-empty `allowed_organization_ids`,
   * and the allow-list restricts whatever the visibility column says. A feed
   * carrying such a row advertises to the whole web an assortment reserved for
   * one distributor.
   *
   * The expectation below is **computed by `isProductVisibleTo`**, never
   * written out. That is the mechanism that keeps the SQL in `sellableFloor`
   * and the TypeScript predicate in `@b2b/contracts` in step: the only way for
   * the two to disagree is for this test to go red, and the domain it sweeps is
   * `productVisibilitySchema.options` × (empty, non-empty), so a fourth
   * visibility value enters the sweep the moment the enum grows.
   *
   * Both methods are asserted for every row, because `countSellable` is what an
   * operator is shown before saving and `listSellable` is what the next run
   * emits. A repair that narrowed one and not the other would keep the
   * disclosure or start lying about the number, and this file is where that has
   * to be caught.
   */
  describe('the floor answers for the anonymous audience', () => {
    it('agrees with `isProductVisibleTo` on every visibility × allow-list state', async () => {
      const seeded = await seedAudienceMatrix(em);
      const wantedIds = seeded.map((row) => row.id);

      const rows = await port.listSellable({ productIds: wantedIds, filter: { kind: 'all' } });
      const returned = new Set(rows.map((row) => row.id));

      for (const row of seeded) {
        const expected = isProductVisibleTo(row, ANONYMOUS_PRODUCT_AUDIENCE);
        expect(
          returned.has(row.id),
          `${row.sku} — visibility ${row.visibility}, allow-list ${
            row.allowedOrganizationIds.length === 0 ? 'empty' : 'non-empty'
          }`,
        ).toBe(expected);
      }
    });

    it('counts exactly what it lists, so the pre-save number is the run’s number', async () => {
      const seeded = await seedAudienceMatrix(em);
      const wantedIds = seeded.map((row) => row.id);
      const visible = seeded.filter((row) =>
        isProductVisibleTo(row, ANONYMOUS_PRODUCT_AUDIENCE),
      ).length;

      const listed = await port.listSellable({ productIds: wantedIds, filter: { kind: 'all' } });
      const counted = await port.countSellable({ productIds: wantedIds, filter: { kind: 'all' } });

      expect(counted).toBe(listed.length);
      expect(counted).toBe(visible);
    });

    it('keeps a `public` product with a non-empty allow-list out, filter or no filter', async () => {
      // The one row the old floor let through, asked for by name: a filter that
      // names it explicitly must not widen the floor past the audience, exactly
      // as it cannot widen it past `status` or `deleted_at`.
      const seeded = await seedAudienceMatrix(em);
      const restricted = seeded.find(
        (row) => row.visibility === 'public' && row.allowedOrganizationIds.length > 0,
      )!;

      const filter: CatalogProductFilter = {
        kind: 'condition',
        field: { kind: 'column', column: 'id' },
        op: 'in',
        values: [restricted.id],
      };
      expect(await port.listSellable({ productIds: [restricted.id], filter })).toEqual([]);
      expect(await port.countSellable({ productIds: [restricted.id], filter })).toBe(0);
    });
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

/**
 * Extra sellable rows for one test, keyed by sku. They are deliberately not in
 * the file-level `ids` map: every other test asserts an exact id set over
 * `all()`, and these rows exist only for the filter the test that seeds them
 * passes their ids to.
 */
async function seedSkus(
  em: EntityManager,
  skus: string[],
  attributeValues: Record<string, Record<string, unknown>> = {},
): Promise<Record<string, string>> {
  const rows = skus.map((sku, index) =>
    em.create(Product, {
      type: 'simple' as const,
      description: {},
      attributeSetId: SET_ID,
      attributeValues: attributeValues[sku] ?? {},
      sku,
      slug: `literal-fixture-${index}`,
      status: 'active',
      visibility: 'public',
      name: { 'en-US': sku },
    }),
  );
  await em.persistAndFlush(rows);
  return Object.fromEntries(rows.map((row) => [row.sku, row.id]));
}

/** One seeded row of the audience matrix, carrying the two columns it is about. */
interface AudienceMatrixRow {
  id: string;
  sku: string;
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
}

/**
 * Every state the two audience columns can be in, seeded as sellable rows.
 *
 * The sweep is the enum × (empty, non-empty) rather than a hand-listed set, so
 * a visibility value added to `productVisibilitySchema` arrives here without
 * anybody remembering to add it — the parity assertion then decides whether the
 * SQL floor and `isProductVisibleTo` still agree about it.
 *
 * Every row is `active`, unarchived and not soft-deleted: the other half of the
 * floor is asserted elsewhere in this file, and a row that failed it would make
 * an absence prove nothing.
 */
async function seedAudienceMatrix(em: EntityManager): Promise<AudienceMatrixRow[]> {
  const ORG = '33333333-3333-4333-8333-333333333333';
  const combinations = productVisibilitySchema.options.flatMap((visibility) =>
    [[], [ORG]].map((allowedOrganizationIds) => ({ visibility, allowedOrganizationIds })),
  );
  const rows = combinations.map((combination, index) =>
    em.create(Product, {
      type: 'simple' as const,
      description: {},
      attributeSetId: SET_ID,
      attributeValues: {},
      sku: `AUDIENCE-${combination.visibility.toUpperCase()}-${
        combination.allowedOrganizationIds.length === 0 ? 'OPEN' : 'LISTED'
      }`,
      slug: `audience-fixture-${index}`,
      status: 'active',
      visibility: combination.visibility,
      allowedOrganizationIds: combination.allowedOrganizationIds,
      name: { 'en-US': `Audience ${index}` },
    }),
  );
  await em.persistAndFlush(rows);
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    visibility: row.visibility,
    allowedOrganizationIds: [...row.allowedOrganizationIds],
  }));
}
