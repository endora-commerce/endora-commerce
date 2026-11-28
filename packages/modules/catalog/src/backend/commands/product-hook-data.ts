import type {
  ProductCreateHookData,
  ProductOutbox,
  ProductScopedValuesHookScope,
  ProductUpdateHookData,
} from '@endora-commerce/contracts';
import type { Product } from '../entities/product.entity.js';
import { toCatalogProductRecord } from '../services/catalog-product-read.service.js';
import { opValue, type ScopedSavePlan } from '../services/scoped-values-save.service.js';

/**
 * The hook data and outbox data of `catalog`'s four hookable actions
 * (`specs/193-admin-form-extensions/` FR-112, `contracts/hookable-writers.md` §3;
 * the refs are `PRODUCT_HOOKABLE_ACTIONS` in `@endora-commerce/contracts`).
 *
 * The bus calls them only when a present hook is registered on the action, after
 * `run` and before the commit. Hook data is held in memory and may carry values;
 * outbox data is ids and field names only (`specs/conventions/audit-state.md`
 * list 1).
 */

/**
 * `specs/193-admin-form-extensions/` D-300.8 (`contracts/hookable-writers.md` §3.1) — the
 * action each product write of a bulk edit runs under, on the inline and the queued path.
 * It is the `product.update` write — the same audit state, `product.updated.v1` and
 * `ProductUpdateHookData` — under its own action, which is **never** declared hookable: the
 * bulk edit is reversible, so no module hook may see it (176 §6). It becomes a rule-check-only
 * writer of the product field set (WP-P1). Module-local on purpose: it is not a ref in
 * `PRODUCT_HOOKABLE_ACTIONS` and not in the manifest's `hookableActions`.
 */
export const PRODUCT_BULK_UPDATE_ITEM_ACTION = 'product.bulk_update.item';

export function productCreateHookData(product: Product, categoryIds: readonly string[]): ProductCreateHookData {
  return { product: toCatalogProductRecord(product), categoryIds: [...categoryIds] };
}

export function productUpdateHookData(
  product: Product,
  changedFields: readonly string[],
  categoryIds: readonly string[] | undefined,
): ProductUpdateHookData {
  return {
    product: toCatalogProductRecord(product),
    changedFields: [...changedFields],
    ...(categoryIds !== undefined ? { categoryIds: [...new Set(categoryIds)] } : {}),
  };
}

export function productOutbox(productId: string, changedFields: readonly string[]): ProductOutbox {
  return { productId, changedFields: [...changedFields] };
}

/**
 * One scope's entry of the scoped hook data: what the plan's cells leave at the
 * scope, keyed by their field path, and the fields they changed. `extra` adds what
 * the save writes beside the plan (the SEO cells, keyed `seo:<field>`), whose
 * `changedFields` then replaces the plan's.
 */
export function scopedValuesHookScope(
  plan: ScopedSavePlan,
  extra?: { readonly after: Readonly<Record<string, unknown>>; readonly changedFields: readonly string[] },
): ProductScopedValuesHookScope {
  const after: Record<string, unknown> = {};
  for (const cell of plan.cells) after[cell.path] = opValue(cell.op);
  if (extra) Object.assign(after, extra.after);
  return { scope: plan.scope, after, changedFields: [...(extra?.changedFields ?? plan.changedFields)] };
}
