import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 170 — product SEO metadata at the three product levels
 * (`specs/170-product-editor-scope-switcher/data-model.md` §8, research R9, R22; FR-010, FR-020).
 *
 * A product row sits at Global (no channel, no locale), Channel (a channel, no locale) or
 * Channel × language (both). The Language-only product row of feature 163 is gone (FR-010).
 * Category and CMS-page rows keep their language rows and are untouched (FR-117).
 *
 * In the R22 order:
 *
 * 1. delete the product rows with a locale and no channel (the Language scope);
 * 2. drop the 163 scope check (at least one half set);
 * 3. add the new check: a product row names no locale without a channel, any other row names
 *    at least one half;
 * 4. one Global row per product — a partial unique no decorator expresses;
 * 5. a plain `(entity_type, entity_id)` index, which the partial uniques do not serve.
 *
 * Every statement is guarded, so a second run is a no-op. Column semantics on product rows:
 * `NULL` = inherit (at Global: no value), `''` = deliberately empty, which makes the storefront
 * use the derived value (owner round 6).
 *
 * `down()` restores the 163 shape and none of the data `up` removed (plan Q7): it deletes the
 * Global product rows the 163 check cannot hold, then puts that check back.
 */
export class Migration20261103T171312SeoProductMetaThreeLevels extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      delete from "seo_meta_overrides"
       where "entity_type" = 'product' and "sales_channel_id" is null and "locale" is not null;
    `);
    this.addSql(`alter table "seo_meta_overrides" drop constraint if exists "seo_meta_overrides_scope_check";`);
    this.addSql(`
      alter table "seo_meta_overrides"
        add constraint "seo_meta_overrides_scope_check" check (
          ("entity_type" = 'product' and ("locale" is null or "sales_channel_id" is not null))
          or ("entity_type" <> 'product' and ("locale" is not null or "sales_channel_id" is not null))
        );
    `);
    this.addSql(`
      create unique index if not exists "seo_meta_overrides_product_global_unique"
        on "seo_meta_overrides" ("entity_type", "entity_id")
        where "sales_channel_id" is null and "locale" is null;
    `);
    this.addSql(`
      create index if not exists "seo_meta_overrides_entity_idx"
        on "seo_meta_overrides" ("entity_type", "entity_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "seo_meta_overrides_entity_idx";`);
    this.addSql(`drop index if exists "seo_meta_overrides_product_global_unique";`);
    this.addSql(`
      delete from "seo_meta_overrides" where "sales_channel_id" is null and "locale" is null;
    `);
    this.addSql(`alter table "seo_meta_overrides" drop constraint if exists "seo_meta_overrides_scope_check";`);
    this.addSql(`
      alter table "seo_meta_overrides"
        add constraint "seo_meta_overrides_scope_check" check ("locale" is not null or "sales_channel_id" is not null);
    `);
  }
}
