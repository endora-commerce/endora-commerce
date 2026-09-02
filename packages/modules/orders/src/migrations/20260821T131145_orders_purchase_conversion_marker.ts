import { Migration } from '@mikro-orm/migrations';

/**
 * Whether an order still owes a GA4 `purchase` conversion (issue #277).
 *
 * The storefront reports an order's conversion on the first page the buyer
 * sees it on and never again, and the two pages that may report it — the
 * checkout Success Page and the order page — are different arrivals of the
 * same conversion. Neither can hold the answer, and neither can the browser:
 * a marker there is gone with the cache and never reaches the buyer's second
 * device. So the order carries it.
 *
 * **The sense is inverted on purpose.** The column records that a conversion
 * is *owed*, not that one was reported, and `default false` is what makes that
 * safe for the rows already in this table: every order placed before this
 * migration was counted already, by the Success Page that counted
 * unconditionally, so `false` reads as *this order owes nothing* — which is
 * the right answer for all of them. A column meaning "already counted" would
 * have had to default to `false` too, and that would have read as *not yet
 * counted*, turning the first view of any historical order into a report of
 * last quarter's revenue against today's date.
 *
 * `purchase_conversion_reported_at` is what keeps the two `false`s apart
 * afterwards: null with `owed = false` is an order that never owed one, a
 * timestamp is an order that was reported, and that distinction is the whole
 * reason the flag alone was not enough to answer "was this counted?".
 *
 * Cost on an existing installation: two added columns, one `boolean not null`
 * with a constant default and one nullable `timestamptz`. PostgreSQL 11 and
 * later store a constant `ADD COLUMN … DEFAULT` in the catalogue instead of
 * rewriting the heap, so both are metadata-only — an `ACCESS EXCLUSIVE` lock
 * held for the catalogue update and nothing proportional to the row count.
 * No backfill, no index, no constraint.
 */
export class Migration20260821T131145OrdersPurchaseConversionMarker extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "orders" add column "purchase_conversion_owed" boolean not null default false;`,
    );
    this.addSql(
      `alter table "orders" add column "purchase_conversion_reported_at" timestamptz null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "orders" drop column "purchase_conversion_reported_at";`);
    this.addSql(`alter table "orders" drop column "purchase_conversion_owed";`);
  }
}
