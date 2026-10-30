import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §4; research R22) — the
 * Channel minimum order quantity gets its own override flag.
 *
 * `product_channel_scopes.min_order_quantity_overridden` says the channel overrides the Global
 * minimum; then `min_order_quantity` `null` means **no minimum in this channel** (round 5), where
 * 163 spelled that `1`. Order (R22): add the flag `default false` → backfill → CHECK. Idempotent:
 * the backfill only touches rows not yet flagged.
 *
 * `down` restores the 163 shape (an overridden "none" becomes `1` again) — structure only, for the
 * clean-run test; not a data-preserving `down` (R18).
 */
export class Migration20261030T113859CatalogScopeModelOrderRules extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_channel_scopes"
      add column if not exists "min_order_quantity_overridden" boolean not null default false;`);
    this.addSql(`update "product_channel_scopes"
      set "min_order_quantity_overridden" = true,
          "min_order_quantity" = case when "min_order_quantity" = 1 then null else "min_order_quantity" end
      where "min_order_quantity" is not null and not "min_order_quantity_overridden";`);
    this.addSql(`alter table "product_channel_scopes" drop constraint if exists "product_channel_scopes_moq_flag_check";`);
    this.addSql(`alter table "product_channel_scopes" add constraint "product_channel_scopes_moq_flag_check"
      check ("min_order_quantity_overridden" or "min_order_quantity" is null);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_channel_scopes" drop constraint if exists "product_channel_scopes_moq_flag_check";`);
    this.addSql(`do $$
      begin
        if exists (select 1 from information_schema.columns where table_schema = current_schema()
                    and table_name = 'product_channel_scopes' and column_name = 'min_order_quantity_overridden') then
          update product_channel_scopes set min_order_quantity = 1
            where min_order_quantity_overridden and min_order_quantity is null;
          alter table product_channel_scopes drop column min_order_quantity_overridden;
        end if;
      end $$;`);
  }
}
