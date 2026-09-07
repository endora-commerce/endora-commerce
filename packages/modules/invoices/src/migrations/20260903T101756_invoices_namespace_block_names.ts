import { Migration } from '@mikro-orm/migrations';
import {
  FROZEN_BLOCK_RENAMES,
  FROZEN_BLOCK_RENAMES_INVERSE,
  applyRenameFunctionSql,
  createRenameFunctionSql,
  dropRenameFunctionSql,
} from '@endora-commerce/page-builder-core/migration';

/**
 * Namespace the Page Builder block names stored in `invoices`'s 1 `jsonb` column
 * — feature 096, T408 (`contracts/block-name-migration.md`).
 *
 * **The rewrite is structural, never textual.** Twelve of the 74 renamed names
 * are ordinary English words that occur throughout shop content — `Row`,
 * `Text`, `Image`, `Map`, `Button` among them — so a text substitution over the
 * column would corrupt a `RawHtml` block's markup and every `alt` attribute in
 * the shop. `pg_temp.rename_block_names_invoices` descends the document and replaces the value of a
 * `type` property in a **node** position and nothing else; the walk is
 * generated from `FROZEN_BLOCK_RENAMES` by
 * `@endora-commerce/page-builder-core/migration`, so five migrations share one
 * definition of what a node is.
 *
 * **This migration belongs to `invoices` because `invoices` owns these tables**,
 * not because it owns the new names (`contracts/block-name-migration.md` §2).
 * Some of the names it writes belong to other modules; that creates no
 * obligation on them and **no new manifest `dependencies` edge**, because a
 * block name is a string value inside a JSONB document — not a foreign key and
 * not a table identifier.
 *
 * **It cannot fail on its input.** A name the map does not hold is left
 * byte-identical: an already-namespaced one and an unrecognised one alike,
 * because the map's domain is bare and its codomain is dotted, so the two sets
 * are disjoint. That is also what makes a second run rewrite nothing — FR-013
 * is a property of the map rather than an outcome a branch has to remember to
 * produce, and no dot test appears in this SQL.
 *
 * `down()` applies the inverse over the identical walk and is **exact for the
 * frozen set**. It is partial by construction: a name with no pre-migration
 * form — a block authored after the upgrade, a third party's `acme.Banner` —
 * has nothing to return to and is left alone. That is correct, and it is why
 * the operator pre-flight (§6) is a backup rather than a `down()`.
 */
/**
 * Named per module: the five rename migrations may run on one pooled session,
 * and a second `create function` over the same name fails. Each drops its own
 * when it is done, and a rollback removes it with everything else — `pg_temp`
 * DDL is transactional.
 */
const FN = 'rename_block_names_invoices';

export class Migration20260903T101756InvoicesNamespaceBlockNames extends Migration {
  override async up(): Promise<void> {
    this.addSql(createRenameFunctionSql(FN, FROZEN_BLOCK_RENAMES));
    this.addSql(applyRenameFunctionSql(FN, 'invoice_templates', 'content'));
    this.addSql(dropRenameFunctionSql(FN));
  }

  override async down(): Promise<void> {
    this.addSql(createRenameFunctionSql(FN, FROZEN_BLOCK_RENAMES_INVERSE));
    this.addSql(applyRenameFunctionSql(FN, 'invoice_templates', 'content'));
    this.addSql(dropRenameFunctionSql(FN));
  }
}
