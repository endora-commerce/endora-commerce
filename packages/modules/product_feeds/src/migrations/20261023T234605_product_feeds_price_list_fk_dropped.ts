import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (FR-029), owner ruling 2026-10-23 — a feed's pinned price book
 * is no longer held by a foreign key.
 *
 * `product_feeds_price_list_fk` was `on delete restrict`: a price book a feed
 * was pinned to could not be deleted, and the 0.108.0 conversion's delete of
 * the old-model lists stopped on it (it now retires such a list instead —
 * `price_lists`' conversion, research R4). Without the key a deleted book
 * leaves the feed's `price_list_id` dangling, which the feed already handles:
 * `namedListPublishability` answers `not_found`, the admin row warns, and the
 * next run withdraws the published file. A new pin is still validated against
 * `price_lists` on write (`ProductFeedService.validateBindings`).
 *
 * It also removes this module's one foreign key into `price_lists`' table
 * (Principle I); the manifest keeps `price_lists` as a dependency for the
 * pricing port. Runs after the conversion — `price_lists` is a dependency, so
 * its migrations come first — which is what an upgrade needs: the conversion
 * no longer depends on this key being gone.
 */
export class Migration20261023T234605ProductFeedsPriceListFkDropped extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_feeds" drop constraint if exists "product_feeds_price_list_fk";`);
  }

  override async down(): Promise<void> {
    // A pin whose book is gone could not satisfy the key: unpin it first.
    this.addSql(
      `update "product_feeds" set "price_list_id" = null
        where "price_list_id" is not null
          and not exists (select 1 from "price_lists" l where l."id" = "product_feeds"."price_list_id");`,
    );
    this.addSql(
      `alter table "product_feeds" add constraint "product_feeds_price_list_fk"
         foreign key ("price_list_id") references "price_lists" ("id")
         on update cascade on delete restrict;`,
    );
  }
}
