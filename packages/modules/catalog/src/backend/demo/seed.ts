/**
 * `catalog`'s demo data (feature 113, T224 — contract §2).
 *
 * The three-level category tree, 200 generated simple products, the three
 * composites and the composites' own structure, in the module that owns every
 * one of those tables. It writes `categories`, `products`, `grouped_items`,
 * `bundle_slots` and `bundle_slot_options` and nothing else (§2.1), reads no
 * other module's table and resolves no port (§2.2), so declaring it added no
 * entry to this module's manifest `dependencies` (§2.3).
 *
 * ## What left the block on the way here, and why
 *
 * **The product attributes.** A product attribute is a
 * `custom_field_definitions` row paired 1:1 with a `product_attributes`
 * extension row — two modules' rows in one statement, so a composition step
 * (§5.1), and it stays on `backend/src/seeds/attribute-fixtures.ts`, which is
 * the one copy of that helper (FR-019) and which says in its own words that a
 * file writing both tables in one call is composition.
 *
 * **The images and the attachments.** Each mints an `assets` row —
 * `assets_library`'s — and hands its id to `product_assets`, `gallery_items`,
 * `gallery_item_labels` or `product_attachments`, all of them this module's. Two
 * modules again, so two more composition steps, and the placeholder generators
 * went with them.
 *
 * What that leaves here is every row whose whole content is this module's, which
 * is 203 products and 13 categories.
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing and reports the same counts.
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import {
  DEMO_COMPOSITE_SKUS,
  DEMO_LEAF_CATEGORIES,
  DEMO_PRODUCT_SLUG_PREFIX,
  DEMO_ROOT_CATEGORY,
  DEMO_SECTION_CATEGORIES,
  PRODUCT_COUNT,
  demoProducts,
} from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface CatalogDemoCradle {
  readonly emFactory: () => EntityManager;
}

/** The demo's three composites, with the structure each carries. */
const COMPOSITES = [
  {
    sku: 'DEMO-GROUPED-0001',
    slug: 'demo-grouped-set-0001',
    type: 'grouped',
    nameEn: 'Starter set (grouped)',
    descriptionEn: 'Starter set bundling two products with fixed quantities.',
    price: 49.99,
  },
  {
    sku: 'DEMO-BUNDLE-0001',
    slug: 'demo-bundle-config-0001',
    type: 'bundle',
    nameEn: 'Configurable bundle',
    descriptionEn: 'Pick a color and quantity to configure your bundle.',
    price: 99.99,
  },
  {
    sku: 'DEMO-VIRTUAL-0001',
    slug: 'demo-virtual-ebook-0001',
    type: 'virtual',
    nameEn: 'B2B Buyer Handbook (e-book)',
    descriptionEn: 'Digital e-book — instant download after purchase.',
    price: 19.99,
    downloadUrl: 'https://example.test/b2b-buyer-handbook.pdf',
  },
] as const;

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader, and the command
  // refuses to run against a production database at all.
  const em = context.ctx.cradle<CatalogDemoCradle>().emFactory();
  const conn = em.getConnection();

  // ── the three-level category tree ─────────────────────────────────────
  let root = await em.findOne(Category, { slug: DEMO_ROOT_CATEGORY.slug });
  if (!root) {
    root = em.create(Category, {
      name: { ...DEMO_ROOT_CATEGORY.name },
      slug: DEMO_ROOT_CATEGORY.slug,
    });
    await em.persistAndFlush(root);
  }

  const sections = new Map<string, Category>();
  for (const section of DEMO_SECTION_CATEGORIES) {
    let row = await em.findOne(Category, { slug: section.slug });
    if (!row) {
      row = em.create(Category, {
        parentCategoryId: root.id,
        name: { 'en-US': section.nameEn },
        slug: section.slug,
      });
      em.persist(row);
    }
    sections.set(section.slug, row);
  }
  await em.flush();

  const leaves = new Map<string, Category>();
  for (const leaf of DEMO_LEAF_CATEGORIES) {
    let row = await em.findOne(Category, { slug: leaf.slug });
    if (!row) {
      row = em.create(Category, {
        parentCategoryId: sections.get(leaf.parentSlug)!.id,
        name: { 'en-US': leaf.nameEn },
        slug: leaf.slug,
      });
      em.persist(row);
    }
    leaves.set(leaf.slug, row);
  }
  await em.flush();

  // ── the 200 simple products ───────────────────────────────────────────
  //
  // The leaf name comes off the row that is actually in the database, so a
  // category an operator renamed is described by the name they gave it rather
  // than by this module's literal.
  const rows = demoProducts(
    (slug) =>
      leaves.get(slug)?.name['en-US'] ??
      DEMO_LEAF_CATEGORIES.find((leaf) => leaf.slug === slug)?.nameEn ??
      slug,
  );
  const existingSimple = await em.find(Product, {
    slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}%` },
  });
  const present = new Set(existingSimple.map((product) => product.slug));
  for (const row of rows) {
    if (present.has(row.slug)) continue;
    em.persist(
      em.create(Product, {
        sku: row.sku,
        slug: row.slug,
        type: 'simple',
        status: 'active',
        name: { 'en-US': row.nameEn },
        description: { 'en-US': row.descriptionEn },
        visibility: 'public',
        attributeValues: { ...row.attributeValues },
      }),
    );
  }
  await em.flush();

  // ── the three composites (T133, US5) ──────────────────────────────────
  //
  // One grouped product with two simple children, one bundle with a slot and
  // two options, one virtual product with a download URL. Their category and
  // channel membership is the composition's, exactly as every other product's
  // is.
  for (const composite of COMPOSITES) {
    if (present.has(composite.slug)) continue;
    const existing = await em.findOne(Product, { slug: composite.slug });
    if (existing) continue;
    em.persist(
      em.create(Product, {
        sku: composite.sku,
        slug: composite.slug,
        type: composite.type,
        status: 'active',
        name: { 'en-US': composite.nameEn },
        description: { 'en-US': composite.descriptionEn },
        visibility: 'public',
        attributeValues: { defaultPrice: composite.price },
        ...('downloadUrl' in composite ? { downloadUrl: composite.downloadUrl } : {}),
      }),
    );
  }
  await em.flush();

  // ── the composites' own structure ─────────────────────────────────────
  //
  // The first four simple products by SKU, which is the creation order the host
  // block took them in: `products[0]` and `products[1]` are the grouped set's
  // children, `products[2]` and `products[3]` the bundle slot's options.
  const grouped = await em.findOne(Product, { sku: 'DEMO-GROUPED-0001' });
  const bundle = await em.findOne(Product, { sku: 'DEMO-BUNDLE-0001' });
  const children = await em.find(
    Product,
    { slug: { $in: rows.slice(0, 4).map((row) => row.slug) } },
  );
  const bySlug = new Map(children.map((product) => [product.slug, product]));
  const ordered = rows.slice(0, 4).map((row) => bySlug.get(row.slug));

  if (grouped && ordered[0] && ordered[1]) {
    const held = await conn.execute<{ n: string }[]>(
      `select count(*)::text as n from grouped_items where parent_product_id = ?`,
      [grouped.id],
    );
    if (Number(held[0]?.n ?? '0') === 0) {
      await conn.execute(
        `insert into grouped_items (id, parent_product_id, child_product_id, quantity, position, created_at, updated_at)
         values (?, ?, ?, 2, 0, now(), now()),
                (?, ?, ?, 1, 1, now(), now())`,
        [
          randomUUID(), grouped.id, ordered[0].id,
          randomUUID(), grouped.id, ordered[1].id,
        ],
      );
    }
  }

  if (bundle && ordered[2] && ordered[3]) {
    const held = await conn.execute<{ n: string }[]>(
      `select count(*)::text as n from bundle_slots where parent_product_id = ?`,
      [bundle.id],
    );
    if (Number(held[0]?.n ?? '0') === 0) {
      const bundleSlotId = randomUUID();
      await conn.execute(
        `insert into bundle_slots (id, parent_product_id, name, min_quantity, max_quantity, position, created_at, updated_at)
         values (?, ?, ?::jsonb, 1, 1, 0, now(), now())`,
        [bundleSlotId, bundle.id, JSON.stringify({ 'en-US': 'Color', 'pl-PL': 'Kolor' })],
      );
      await conn.execute(
        `insert into bundle_slot_options (id, slot_id, option_product_id, default_quantity, position, created_at, updated_at)
         values (?, ?, ?, 1, 0, now(), now()),
                (?, ?, ?, 1, 1, now(), now())`,
        [
          randomUUID(), bundleSlotId, ordered[2].id,
          randomUUID(), bundleSlotId, ordered[3].id,
        ],
      );
    }
  }

  // The counts are what the demo *holds* after the run, not what this call
  // inserted: seeding twice must report the same counts (`DemoEntityCount`).
  return {
    created: [
      {
        entity: 'Category',
        count: 1 + DEMO_SECTION_CATEGORIES.length + DEMO_LEAF_CATEGORIES.length,
      },
      { entity: 'Product', count: PRODUCT_COUNT + DEMO_COMPOSITE_SKUS.length },
    ],
  };
}
