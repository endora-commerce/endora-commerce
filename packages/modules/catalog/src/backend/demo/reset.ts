/**
 * Withdraw `catalog`'s demo data (feature 113, T224 — contract §2.5).
 *
 * By the slugs and the slug prefix `seed` assigns, never by a predicate over
 * the table. This is the withdrawal that replaces the longest run of lines in
 * the host's `truncate … cascade` — `products`, `categories`, and the
 * composites' three structure tables — and the replacement is a repair rather
 * than a relocation: a truncate cannot tell a demo product from a catalogue an
 * operator has been building, and on this table that is somebody's whole shop.
 *
 * The order below is the FK graph read backwards, and it is written out rather
 * than left to a cascade for the same reason: a cascade would reach rows this
 * demo did not create.
 *
 * Everything that *references* these products from another module's table — the
 * category and channel bridges, the price brackets, the stock, the images and
 * the attachments — is withdrawn first, by the composition, because `reset`
 * runs the composition's withdrawal before any module's (§5.5).
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import {
  DEMO_CATEGORY_SLUGS_DEEPEST_FIRST,
  DEMO_COMPOSITE_SKUS,
  DEMO_PRODUCT_SLUG_PREFIX,
} from './rows.js';

interface CatalogDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<CatalogDemoCradle>().emFactory();
  const conn = em.getConnection();
  // `?, ?, ?` rather than `= any(?)`: the connection binds an array by
  // **expanding** it into a comma-separated list, so `any(?)` becomes
  // `any('a', 'b')` and Postgres refuses it.
  const skus = [...DEMO_COMPOSITE_SKUS];
  const compositePlaceholders = skus.map(() => '?').join(', ');

  // The composites' structure first: every row of it points at a product this
  // call is about to remove.
  await conn.execute(
    `delete from bundle_slot_options where slot_id in
       (select s.id from bundle_slots s
          join products p on p.id = s.parent_product_id
         where p.sku in (${compositePlaceholders}))`,
    skus,
  );
  await conn.execute(
    `delete from bundle_slots where parent_product_id in
       (select id from products where sku in (${compositePlaceholders}))`,
    skus,
  );
  await conn.execute(
    `delete from grouped_items where parent_product_id in
       (select id from products where sku in (${compositePlaceholders}))`,
    skus,
  );

  // Both the 200 simple products and the three composites carry the prefix.
  const products = await em.nativeDelete(Product, {
    slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}%` },
  });

  // Deepest first, so no parent goes while a child still points at it.
  let categories = 0;
  for (const level of DEMO_CATEGORY_SLUGS_DEEPEST_FIRST) {
    categories += await em.nativeDelete(Category, { slug: { $in: [...level] } });
  }

  return {
    removed: [
      { entity: 'Category', count: categories },
      { entity: 'Product', count: products },
    ],
  };
}
