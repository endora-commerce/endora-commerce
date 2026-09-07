/**
 * R2 — migrations in `catalog` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too.
 *
 * **This ledger is expected to drain.** A declared dependency answers "must that
 * module be installed, and does its schema run first"; it does not answer "who
 * decides what is in that table". Every entry below therefore names the seam its
 * repair takes, not merely what the finding is.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

/**
 * What both entries here have in common, said once.
 *
 * Feature 061's convergence is a one-way move of `catalog`'s own legacy registry
 * **into** `custom_fields`' tables, so the two seams `research.md` §8 offers the
 * adapter seeds are both unavailable in their usual form: the owner cannot write
 * the migration, because the source rows are `product_attributes`' and
 * `custom_fields` has never heard of them; and an `installHook` cannot, because
 * this runs once against data that exists only on a database upgrading across
 * feature 061 — a hook that re-runs by contract is the wrong shape for a
 * one-way conversion.
 */
const CONVERGENCE =
  'The write is feature 061\'s one-way convergence of the legacy `product_attributes` ' +
  'registry onto the Custom Fields layer, inside one transaction, and it is not a seed: it ' +
  'copies rows that exist only on a database being upgraded across that feature. Both seams ' +
  '`research.md` §8 offers the adapter seeds are therefore unavailable as written. The ' +
  'owner\'s own migration cannot do it — `custom_fields` has never heard of ' +
  '`product_attributes`, and giving it that knowledge inverts the dependency the manifest ' +
  'declares. An `installHook` cannot either: it re-runs by contract, and a one-way ' +
  'conversion of rows it has already consumed is exactly the shape that must not.\n\n' +
  '**Seam: `custom_fields`\' published apply seam.** That module already publishes an ' +
  '`EntityManager`-taking definition-apply API for this reason — a child insert must see ' +
  'its parent inside one transaction because of ' +
  '`fk_product_attributes_custom_field_definition` — and D-169 rules that shape for a ' +
  'cross-module seam running inside the caller\'s transaction. What is missing is a caller ' +
  'that is not a migration.\n\n' +
  'Retired by: an owner ruling on where a **one-way historical conversion** into another ' +
  'module\'s tables lives, which `research.md` §8 does not answer and which the two adapter ' +
  'families do not raise. Constrained by the stamp: `20260723T230401` is below ' +
  '`BASELINE_THROUGH`, so whatever replaces it has to be a no-op on every database that has ' +
  'already applied it.';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/catalog/src/migrations/20260723T230401_catalog_attributes_on_custom_fields.ts:custom_field_definitions':
    {
      sites: 2,
      reason:
        'One `custom_field_definitions` row per legacy product attribute, plus the collision ' +
        'assertion that reads the table first (data-model.md §3, research §R5).\n\n' +
        CONVERGENCE,
    },
  'packages/modules/catalog/src/migrations/20260723T230401_catalog_attributes_on_custom_fields.ts:custom_field_options':
    {
      sites: 2,
      reason:
        '`attribute_options` copied into `custom_field_options`, with new option ids because ' +
        'product data and filter URLs reference an option by `value` rather than by id.\n\n' +
        CONVERGENCE,
    },
};
