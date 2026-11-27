// `catalog`'s hookable actions — `specs/193-admin-form-extensions/` FR-112 – FR-114,
// `contracts/hookable-writers.md` §3 (the mechanism is `specs/176-command-hooks-outbox/`).
//
// The four Product writes an instance may take part in through a command hook,
// which are also the writers of the product field set (WP-P1). The action strings,
// the phases and the data types are a public contract: changing one is a
// changeset on `@endora-commerce/contracts`. All four are additive.
//
// `product.bulk_update` is **not** declared: a bulk edit is reversible (its
// undo, `product.bulk_update.undo`, restores the products it changed), and 176
// §6 keeps hooks off a reversible write (FR-113).

import { hookableAction } from './command-hooks.js';
import type { CatalogProductRecord } from './catalog.js';
import type { ScopeRef } from './product-scope-model.js';

/**
 * `product.create` — a product was created. `product` reflects the
 * **uncommitted** row on the Command's transaction.
 */
export interface ProductCreateHookData {
  readonly product: CatalogProductRecord;
  /** The categories the create linked, deduplicated, in request order. */
  readonly categoryIds: readonly string[];
}

/**
 * `product.update` — an existing product's global values changed (the admin
 * `PATCH`, the aggregate port's `update` and `setCustomFieldValues`, and each
 * product of a bulk edit). `product` is the after-state.
 */
export interface ProductUpdateHookData {
  readonly product: CatalogProductRecord;
  /** Names of the fields whose value changed; empty when the write changed nothing. */
  readonly changedFields: readonly string[];
  /**
   * The categories the product holds after the write, when the write named its
   * category set; absent when it left the categories alone.
   */
  readonly categoryIds?: readonly string[];
}

/** One scope a scoped write saved. */
export interface ProductScopedValuesHookScope {
  readonly scope: ScopeRef;
  /**
   * What the write left at this scope, keyed by the scoped-value field path
   * (`name`, `attribute:<key>`, `gallery:<id>:altText`, `product.<field>` for a
   * global-only field, `seo:<field>`): the value set, `null` for an empty
   * override, `{ inherit: true }` for a removed one.
   */
  readonly after: Readonly<Record<string, unknown>>;
  /** Names of the fields this scope's write changed. */
  readonly changedFields: readonly string[];
}

/**
 * `product.scoped_values.save` (the editor's save of one scope) and
 * `product.scoped_values.import` (an integration's write, through the aggregate
 * port, the deprecated scope write port or the products import) — one entry per
 * scope the Command saved.
 */
export interface ProductScopedValuesHookData {
  readonly productId: string;
  readonly scopes: readonly ProductScopedValuesHookScope[];
}

/**
 * `afterCommit` data: ids and field names only (audit-state list 1). A product
 * belongs to no Organization, so no row is pinned to one; handlers run in system
 * scope. `changedFields` is empty on create.
 */
export type ProductOutbox = {
  readonly productId: string;
  readonly changedFields: readonly string[];
};

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: PRODUCT.update, … }])`)
 * and the `catalog` manifest lists. All four offer both phases; the
 * `afterCommit` delivery is the transactional outbox.
 */
export const PRODUCT_HOOKABLE_ACTIONS = {
  create: hookableAction<ProductCreateHookData, ProductOutbox>('product.create', 'product', ['beforeCommit', 'afterCommit']),
  update: hookableAction<ProductUpdateHookData, ProductOutbox>('product.update', 'product', ['beforeCommit', 'afterCommit']),
  scopedValuesSave: hookableAction<ProductScopedValuesHookData, ProductOutbox>(
    'product.scoped_values.save',
    'product',
    ['beforeCommit', 'afterCommit'],
  ),
  scopedValuesImport: hookableAction<ProductScopedValuesHookData, ProductOutbox>(
    'product.scoped_values.import',
    'product',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
