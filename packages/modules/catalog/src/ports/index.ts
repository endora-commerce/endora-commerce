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

/** A baseline value removed from under a rename's destination. */
export interface CatalogDisplacedAttributeValue {
  readonly productId: string;
  readonly value: unknown;
}

/** An override row removed from under a rename's destination. */
export interface CatalogDisplacedValueOverride {
  readonly productId: string;
  readonly channelId: string;
  readonly languageCode: string | null;
  /** The stored `{ v: … }` wrapper, as it was. */
  readonly value: unknown;
}

/**
 * What a rename does when something is already stored under `toKey`. There is
 * no default: the caller states the choice, for the reason D-169 makes the
 * `EntityManager` required — a default is a decision the caller never saw.
 *
 * - `refuse` — throw `target_occupied`, naming the key and both counts, before
 *   anything is written.
 * - `displace` — remove everything under `toKey`, baseline values and override
 *   rows alike, on every product that holds it, and return it in
 *   {@link CatalogAttributeValueKeyMove.displaced}; then move the key.
 */
export interface CatalogAttributeValueKeyRenameOptions {
  readonly occupied: 'refuse' | 'displace';
}

/** How many rows a value-key rename moved, per place the key is stored. */
export interface CatalogAttributeValueKeyMove {
  /** Products whose `attribute_values` map carried the old key. */
  readonly products: number;
  /** Channel/locale override rows keyed by the old key. */
  readonly overrides: number;
  /** What `displace` removed from under `toKey`; both lists empty otherwise. */
  readonly displaced: {
    readonly values: readonly CatalogDisplacedAttributeValue[];
    readonly overrides: readonly CatalogDisplacedValueOverride[];
  };
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
 * **Data already under `toKey`** is never merged into the moved value and never
 * left to collide with it (`specs/134-paid-module-extraction/research.md` D12,
 * *what a rename does to data already under its destination*). The caller
 * chooses with {@link CatalogAttributeValueKeyRenameOptions}: `refuse` writes
 * nothing, `displace` removes it — on every product that holds it, not only
 * those also holding `fromKey` — and hands it back so the caller can record
 * it. The destination rows are read `for update`, on the caller's transaction,
 * before anything is written.
 *
 * The moves are conditioned on `fromKey`, so re-running is a no-op; a rename
 * to the same key issues nothing. `name`, `description` and any key outside
 * the attribute grammar are refused before a statement is issued.
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
    options: CatalogAttributeValueKeyRenameOptions,
  ): Promise<CatalogAttributeValueKeyMove>;
}
