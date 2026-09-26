/**
 * The port interfaces `catalog` publishes whose signature carries the caller's
 * `EntityManager`, and **nothing that exists at runtime** (D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — so a consumer naming this subpath
 * names a declaration and can name nothing else. Every other `catalog` port is
 * declared in `@endora-commerce/contracts`; one lands here only when its
 * signature stops it living there: that package is compiled by `admin` and
 * `storefront`, and FR-034 keeps it free of `@mikro-orm` imports.
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/** How many rows a value-key rename moved, per place the key is stored. */
export interface CatalogAttributeValueKeyMove {
  /** Products whose `attribute_values` map carried the old key. */
  readonly products: number;
  /** Channel/locale override rows keyed by the old key. */
  readonly overrides: number;
}

/**
 * Container name: `catalogAttributeValueKeyPort`. Owner: `catalog`.
 *
 * Renames an attribute's **value key** everywhere the catalogue stores it as a
 * string — the `products.attribute_values` JSONB map and
 * `product_value_overrides.attribute_key` — inside the **caller's**
 * transaction (`specs/134-paid-module-extraction/research.md` D12, *Ergonode
 * fallback boundary*).
 *
 * It is one half of a key rename and never the whole of one. The definition's
 * key is `custom_fields`' row, renamed through `applyRenameKey` on
 * `@endora-commerce/mod-custom-fields/ports` in the same transaction, and the
 * caller publishes that seam's invalidation after it commits. The seam exists
 * for a module repairing keys **it derived itself** — the connector owns which
 * rows are candidates and where each one goes; `catalog` owns the rows.
 *
 * **The `EntityManager` is required and never optional** (D-169): the two
 * statements and the definition rename must commit or roll back together, and
 * an optional transaction lets a caller hand one to an implementation that
 * ignores it and receive a silently non-atomic write.
 *
 * Both statements are conditioned on `fromKey`, so re-running is a no-op; a
 * rename to the same key issues nothing. `name`, `description` and any key
 * outside the attribute grammar are refused before a statement is issued.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError`, so nothing half-executes. Whether `catalog` has an off
 * state at all is its manifest's `activation` to say, not this line's.
 */
export interface CatalogAttributeValueKeyApi {
  renameValueKey(
    em: EntityManager,
    fromKey: string,
    toKey: string,
  ): Promise<CatalogAttributeValueKeyMove>;
}
