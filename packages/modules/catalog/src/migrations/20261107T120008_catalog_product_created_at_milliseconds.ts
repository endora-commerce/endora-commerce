import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #234 — store `products.created_at` to the millisecond.
 *
 * The storefront listing pages by the keyset `(created_at, id)`, and its
 * cursor carries `created_at` as a millisecond ISO string because that is all
 * a JavaScript `Date` holds. A row written through the ORM has a millisecond
 * value; a row whose `created_at` came from SQL `now()` — an import, a seed, a
 * bulk insert — had microseconds. For such rows the next page's
 * `created_at < T.mmm` left out the rest of that millisecond, and
 * `created_at = T.mmm` matched none of it, so the listing never returned them.
 * The price-range path and the price tail use the same keyset.
 *
 * `timestamptz(3)` makes PostgreSQL round every value it stores to the
 * millisecond, whoever writes it, so the cursor's precision and the column's
 * are the same and cannot drift apart again. The cursor logic, and every
 * cursor already handed out, stay as they are (architect ruling 6,
 * 2026-11-07).
 *
 * Existing values are rounded to the nearest millisecond (PostgreSQL rounds,
 * it does not truncate). That can move a row's `created_at` by up to half a
 * millisecond and give two rows the same value; `id` already breaks ties in
 * every ordering over it.
 *
 * **Cost.** Changing the precision rewrites `products` and its indexes under
 * an `ACCESS EXCLUSIVE` lock, which blocks reads and writes of the table for
 * the duration of the rewrite.
 *
 * `down()` widens the column back to microseconds; the precision dropped by
 * `up()` is not restored.
 */
export class Migration20261107T120008CatalogProductCreatedAtMilliseconds extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "products" alter column "created_at" type timestamptz(3);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "products" alter column "created_at" type timestamptz;`);
  }
}
