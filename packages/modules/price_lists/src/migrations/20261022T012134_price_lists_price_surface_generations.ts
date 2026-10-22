import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (`contracts/price-surface.md` §3) — a request never waits on a
 * surface build, so a profile keeps serving its previous surface while the
 * worker builds the next one.
 *
 * - `price_profile_prices.generation` — the rows of one build. A build writes
 *   the next generation beside the one being served and swaps it in with one
 *   update of `price_profiles.serving_generation`, then drops the old rows; a
 *   reader filters on the served generation, so it sees one build or the other,
 *   never a mix. The primary key and the ordering index gain the column.
 * - `price_profiles.stale` and `marked_at` — a pricing write marks a ready
 *   profile stale (it keeps serving) instead of unready; a build clears the
 *   mark only if no write marked it again after the build began.
 *
 * The existing rows are generation 0 and the existing `ready` profiles serve
 * it, so nothing is rebuilt by the migration.
 */
export class Migration20261022T012134PriceListsPriceSurfaceGenerations extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "price_profiles" add column if not exists "serving_generation" integer not null default 0;`);
    this.addSql(`alter table "price_profiles" add column if not exists "stale" boolean not null default false;`);
    this.addSql(`alter table "price_profiles" add column if not exists "marked_at" timestamptz null;`);
    this.addSql(`alter table "price_profile_prices" add column if not exists "generation" integer not null default 0;`);
    this.addSql(`alter table "price_profile_prices" drop constraint if exists "price_profile_prices_pkey";`);
    this.addSql(
      `alter table "price_profile_prices" add constraint "price_profile_prices_pkey" primary key ("profile_id", "generation", "product_id");`,
    );
    this.addSql(`drop index if exists "price_profile_prices_order_idx";`);
    this.addSql(
      `create index if not exists "price_profile_prices_order_idx"
         on "price_profile_prices" ("profile_id", "generation", "amount", "product_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "price_profile_prices" p using "price_profiles" f
                  where f."id" = p."profile_id" and p."generation" <> f."serving_generation";`);
    this.addSql(`drop index if exists "price_profile_prices_order_idx";`);
    this.addSql(`alter table "price_profile_prices" drop constraint if exists "price_profile_prices_pkey";`);
    this.addSql(`alter table "price_profile_prices" add constraint "price_profile_prices_pkey" primary key ("profile_id", "product_id");`);
    this.addSql(`alter table "price_profile_prices" drop column if exists "generation";`);
    this.addSql(
      `create index if not exists "price_profile_prices_order_idx" on "price_profile_prices" ("profile_id", "amount", "product_id");`,
    );
    this.addSql(`alter table "price_profiles" drop column if exists "marked_at";`);
    this.addSql(`alter table "price_profiles" drop column if exists "stale";`);
    this.addSql(`alter table "price_profiles" drop column if exists "serving_generation";`);
  }
}
