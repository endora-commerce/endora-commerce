import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogAttributeView } from '@endora-commerce/contracts';

import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';

/**
 * The rules a write of a product's Global-only fields holds, whichever route carries it: the
 * product `PATCH` (`CatalogAdminService`) and the scoped save (`product.scoped_values.save`,
 * feature 174, C2/C3 code review 1). Each rule answers what is wrong and leaves the refusal's
 * shape to its caller, because the two routes answer in their own contracts' error shapes. Every
 * query runs on the caller's `em`, inside the caller's transaction.
 */

/** `products.sku`'s width, and the cap the create contract enforces (feature 068). */
export const PRODUCT_SKU_MAX = 255;

/** Who already holds a SKU: another product, or a variant (one namespace, feature 025). */
export type SkuHolder = { productId: string } | { variantId: string };

/**
 * The holder of `sku` other than `productId`, or `null` when it is free. Variants share the
 * namespace and the database does not enforce that, so both tables are read.
 */
export async function findSkuHolder(em: EntityManager, productId: string, sku: string): Promise<SkuHolder | null> {
  const product = await em.findOne(Product, { sku }, { fields: ['id'] });
  if (product && product.id !== productId) return { productId: product.id };
  const variant = await em.findOne(ProductVariant, { sku }, { fields: ['id'] });
  if (variant) return { variantId: variant.id };
  return null;
}

/** Whether an attribute set exists. */
export async function attributeSetExists(em: EntityManager, attributeSetId: string): Promise<boolean> {
  const rows = await em.execute<Array<{ id: string }>>(`select id from attribute_sets where id = ?`, [attributeSetId]);
  return rows.length > 0;
}

/** The ids among `categoryIds` that name no category, or a deleted one. */
export async function missingCategoryIds(em: EntityManager, categoryIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return [];
  const rows = await em.execute<Array<{ id: string }>>(
    `select id::text as id from categories where deleted_at is null and id in (${ids.map(() => '?').join(', ')})`,
    ids,
  );
  const found = new Set(rows.map((row) => row.id));
  return ids.filter((id) => !found.has(id));
}

/**
 * The keys of the set's required attributes that `values` leaves without a value (feature 012,
 * FR-013): absent, `null` and `''` count as no value.
 */
export function missingRequiredAttributeKeys(
  setAttributes: Iterable<CatalogAttributeView>,
  values: Readonly<Record<string, unknown>>,
): string[] {
  const missing: string[] = [];
  for (const view of setAttributes) {
    if (!view.isRequired) continue;
    const value = values[view.key];
    if (value === undefined || value === null || value === '') missing.push(view.key);
  }
  return missing;
}

/**
 * Makes `product_categories` hold exactly `categoryIds` for one product: the current rows are
 * read and only the difference is deleted or inserted. Returns whether anything was written. A
 * repeated id is one membership (the bridge's primary key is the pair).
 */
export async function reconcileProductCategories(
  em: EntityManager,
  productId: string,
  categoryIds: readonly string[],
): Promise<boolean> {
  // Runs only inside a caller's Command (`product.create`, `product.update`,
  // `product.scoped_values.save`) on that Command's `em`.
  const conn = em.getConnection();
  const txCtx = em.getTransactionContext();
  const currentRows = (await conn.execute<Array<{ category_id: string }>>(
    `select category_id from product_categories where product_id = ?`,
    [productId],
    'all',
    txCtx,
  )) as Array<{ category_id: string }>;
  const current = new Set(currentRows.map((r) => r.category_id));
  const target = new Set(categoryIds);
  const toAdd = [...target].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !target.has(id));
  if (toRemove.length > 0) {
    const placeholders = toRemove.map(() => '?').join(',');
    await conn.execute(
      `delete from product_categories where product_id = ? and category_id in (${placeholders})`,
      [productId, ...toRemove],
      'run',
      txCtx,
    );
  }
  if (toAdd.length > 0) {
    const placeholders = toAdd.map(() => '(?,?)').join(',');
    const params: unknown[] = [];
    for (const cid of toAdd) {
      params.push(productId, cid);
    }
    await conn.execute(
      `insert into product_categories (product_id, category_id) values ${placeholders}`,
      params,
      'run',
      txCtx,
    );
  }
  return toAdd.length > 0 || toRemove.length > 0;
}
