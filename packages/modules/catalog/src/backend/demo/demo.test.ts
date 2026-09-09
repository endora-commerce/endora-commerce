/**
 * The properties of a demo body that no database comparison can see (feature
 * 113, T224 — contract §2.4, §2.5 and §5.1).
 *
 * `test/integration/demo/demo-parity.test.ts` seeds two databases and diffs
 * them, which is what says these 203 products and 13 categories are the rows the
 * host used to write. It cannot say that a second call creates nothing, and it
 * cannot say that the withdrawal is *filtered* — which on this module's tables
 * is the assertion that matters most, because what a `delete from products`
 * takes on a developer's machine is a catalogue somebody has been building.
 *
 * The generator is asserted directly, because the one regression this block has
 * actually had is invisible to a row count: the host kept a parallel
 * `productLeaves` array beside the products and an off-by-one between the naming
 * loop and the category loop filed every product under its neighbouring
 * category, so a product named "Screws …" ended up under Helmets.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import {
  DEMO_CATEGORY_SLUGS_DEEPEST_FIRST,
  DEMO_COMPOSITE_SKUS,
  DEMO_LEAF_CATEGORIES,
  DEMO_PRODUCT_SLUG_PREFIX,
  PRODUCT_COUNT,
  buildProductDescription,
  demoProducts,
} from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

interface FakeRow {
  slug?: string;
  sku?: string;
  id: string;
  [key: string]: unknown;
}

/**
 * A minimal EntityManager over two in-memory tables, keyed the way the real ones
 * are: `slug` is unique on both `categories` and `products`.
 */
function fakeEm(seeded: readonly FakeRow[] = []): {
  em: EntityManager;
  created: FakeRow[];
  deletes: unknown[];
  sql: string[];
} {
  const rows: FakeRow[] = [...seeded];
  const created: FakeRow[] = [];
  const deletes: unknown[] = [];
  const sql: string[] = [];
  let next = 0;
  const matches = (row: FakeRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      const held = row[key];
      if (value !== null && typeof value === 'object') {
        const clause = value as { $like?: string; $in?: unknown[] };
        if (clause.$like !== undefined) {
          return typeof held === 'string' && held.startsWith(clause.$like.replace('%', ''));
        }
        if (clause.$in !== undefined) return clause.$in.includes(held);
      }
      return held === value;
    });
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) =>
      rows.find((row) => matches(row, where)) ?? null,
    find: async (_entity: unknown, where: Record<string, unknown>) =>
      rows.filter((row) => matches(row, where)),
    create: (_entity: unknown, payload: Record<string, unknown>) => {
      next += 1;
      const row = { id: `id-${next}`, ...payload } as FakeRow;
      rows.push(row);
      created.push(row);
      return row;
    },
    persist: () => undefined,
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
    nativeDelete: async (_entity: unknown, where: Record<string, unknown>) => {
      deletes.push(where);
      const hit = rows.filter((row) => matches(row, where));
      for (const row of hit) rows.splice(rows.indexOf(row), 1);
      return hit.length;
    },
    getConnection: () => ({
      execute: async (statement: string) => {
        sql.push(statement.trim().split('\n')[0]!.trim());
        return [{ n: '0' }];
      },
    }),
  };
  return { em: em as unknown as EntityManager, created, deletes, sql };
}

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  };
}

describe('catalog demo rows', () => {
  const rows = demoProducts((slug) => slug.toUpperCase());

  it('generates one product per count, with unique slugs and SKUs', () => {
    expect(rows).toHaveLength(PRODUCT_COUNT);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(PRODUCT_COUNT);
    expect(new Set(rows.map((row) => row.sku)).size).toBe(PRODUCT_COUNT);
  });

  it('agrees with itself about which leaf a product belongs to', () => {
    // The measured regression: the name, the SKU and the slug must all name the
    // same leaf, because the composition resolves a product's category from its
    // slug and nothing else reconciles the three.
    for (const row of rows) {
      expect(row.sku).toContain(row.leafSlug.toUpperCase());
      expect(row.slug.startsWith(`${DEMO_PRODUCT_SLUG_PREFIX}${row.leafSlug}-`)).toBe(true);
      expect(row.nameEn.toLowerCase()).toContain(row.leafSlug.toUpperCase().toLowerCase());
    }
  });

  it('spreads the catalogue across every leaf', () => {
    const used = new Set(rows.map((row) => row.leafSlug));
    expect(used.size).toBe(DEMO_LEAF_CATEGORIES.length);
  });

  it('builds a deterministic, three-paragraph description', () => {
    const input = {
      productName: 'Screws 0001',
      leafNameEn: 'Screws',
      color: 'red',
      material: 'steel',
      weightKg: 1.2,
      certification: 'ISO9001',
    };
    const first = buildProductDescription(input);
    expect(buildProductDescription(input)).toBe(first);
    expect(first.split('\n\n')).toHaveLength(3);
    expect(first).toContain('ISO9001');
    expect(buildProductDescription({ ...input, certification: null })).not.toContain('ISO9001');
  });
});

describe('catalog demo data', () => {
  it('creates the tree and the catalogue on an empty database', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    const categories = created.filter((row) => typeof row['slug'] === 'string' && !row['sku']);
    expect(categories).toHaveLength(13);
    expect(created.filter((row) => row['sku']).length).toBe(
      PRODUCT_COUNT + DEMO_COMPOSITE_SKUS.length,
    );
    expect(result.created).toEqual([
      { entity: 'Category', count: 13 },
      { entity: 'Product', count: PRODUCT_COUNT + DEMO_COMPOSITE_SKUS.length },
    ]);
  });

  it('creates nothing on a second run and reports the same counts (§2.4)', async () => {
    const { em, created } = fakeEm();
    await seedDemo(contextOver(em));
    const afterFirst = created.length;
    const result = await seedDemo(contextOver(em));
    expect(created).toHaveLength(afterFirst);
    expect(result.created).toEqual([
      { entity: 'Category', count: 13 },
      { entity: 'Product', count: PRODUCT_COUNT + DEMO_COMPOSITE_SKUS.length },
    ]);
  });

  it('withdraws by the slugs it assigned, never by the table (§2.5)', async () => {
    const { em, deletes } = fakeEm([
      { id: 'op-1', slug: 'operator-own-product', sku: 'OP-1' },
      { id: 'op-2', slug: 'operator-own-category' },
    ]);
    await resetDemo(contextOver(em));
    expect(deletes).toEqual([
      { slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}%` } },
      ...DEMO_CATEGORY_SLUGS_DEEPEST_FIRST.map((level) => ({ slug: { $in: [...level] } })),
    ]);
    // The operator's rows are untouched, which a row-count assertion could not
    // tell from a `delete from products` that happened to remove the same number.
    expect(await em.find(Product, {})).toHaveLength(2);
  });

  it('removes the composites\' structure before the products it hangs off', async () => {
    const { em, sql } = fakeEm();
    await resetDemo(contextOver(em));
    expect(sql).toEqual([
      'delete from bundle_slot_options where slot_id in',
      'delete from bundle_slots where parent_product_id in',
      'delete from grouped_items where parent_product_id in',
    ]);
  });

  it('is declared over the entities this module owns', () => {
    expect(Category.name).toBe('Category');
    expect(Product.name).toBe('Product');
  });
});
