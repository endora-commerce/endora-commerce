import { UniqueConstraintViolationException } from '@mikro-orm/core';

/**
 * The unique indexes that hold a live product's SKU unique
 * (`20261107T093126_catalog_sku_unique_among_live`; `products_sku_unique` is the
 * constraint it replaced, kept so a database not yet migrated answers the same).
 */
const PRODUCT_SKU_UNIQUE_CONSTRAINTS: ReadonlySet<string> = new Set(['products_sku_live_unique', 'products_sku_unique']);

/**
 * Whether `error` is the database refusing a product SKU that is already taken —
 * and not any other unique violation inside the same transaction. A product write
 * that is a hookable action (`specs/193-admin-form-extensions/` FR-112) runs a
 * hook module's writes on its transaction, so a broad
 * `instanceof UniqueConstraintViolationException` would answer a hook's own
 * violation as `SKU_ALREADY_EXISTS`. The constraint name is read from the
 * exception and from the driver error it wraps.
 */
export function isProductSkuUniqueViolation(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintViolationException)) return false;
  let cursor: unknown = error;
  for (let depth = 0; cursor !== null && typeof cursor === 'object' && depth < 5; depth += 1) {
    const named = (cursor as { constraint?: unknown }).constraint;
    if (typeof named === 'string') return PRODUCT_SKU_UNIQUE_CONSTRAINTS.has(named);
    const wrapped = cursor as { previous?: unknown; cause?: unknown };
    cursor = wrapped.previous ?? wrapped.cause;
  }
  return false;
}
