import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (`contracts/price-surface.md` §4, owner ruling 2026-10-23) — the
 * price surface is refreshed per trigger, at (profile) and (profile, product)
 * granularity, instead of every profile being rebuilt after any pricing write.
 *
 * - `price_profile_stale_products` — a (profile, product) mark: a write that
 *   moves the price of some products marks them in the profiles it concerns;
 *   the worker re-resolves just those products and replaces their rows of the
 *   served generation in one transaction. A mark is only ever inserted —
 *   a second write is a second row — and the worker deletes the rows it read,
 *   by id, so a write landing during a pass is picked up by the next one, and a
 *   writer and the worker never lock the same mark (no update, so no deadlock
 *   between a burst of writes and a refresh). Cascades with its profile.
 * - `price_profiles.revision` — moved by every build and every targeted
 *   refresh: what the read path's memo of a pair of surfaces is keyed on (a
 *   targeted refresh changes rows without moving `serving_generation`).
 *
 * The whole-profile mark (`stale`, `marked_at`) stays, for the triggers that
 * do concern every product of a profile (a channel change, an all-products
 * selection, the precedence).
 */
export class Migration20261023T152351PriceListsPriceSurfaceTargetedMarks extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "price_profiles" add column if not exists "revision" integer not null default 0;`);
    this.addSql(
      `create table if not exists "price_profile_stale_products" (
         "id" bigint generated always as identity primary key,
         "profile_id" uuid not null references "price_profiles" ("id") on delete cascade,
         "product_id" uuid not null,
         "marked_at" timestamptz not null default clock_timestamp()
       );`,
    );
    this.addSql(
      `create index if not exists "price_profile_stale_products_profile_idx" on "price_profile_stale_products" ("profile_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "price_profile_stale_products";`);
    this.addSql(`alter table "price_profiles" drop column if exists "revision";`);
  }
}
