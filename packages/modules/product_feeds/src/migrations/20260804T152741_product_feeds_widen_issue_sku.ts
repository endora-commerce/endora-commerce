import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 068 (Ergonode PIM integration) — widen the run-issue SKU snapshot
 * from 64 to 255 characters (data-model §12), following the catalog module
 * widening `products.sku` and `product_variants.sku` in the same feature.
 *
 * `product_feed_run_issues.sku` — created by
 * `20260802T073627_product_feeds_runs.ts` — is a snapshot rather than a
 * reference: it deliberately carries no foreign key so feed diagnostics
 * survive the deletion of the product they describe. That is exactly why it
 * has to grow with the identifier. Left at 64 it would mangle the diagnostics
 * for precisely the long-SKU products an operator is most likely to be
 * investigating.
 *
 * No foreign key is added, so the module's manifest `dependencies` are
 * unchanged.
 *
 * **`down()` refuses rather than truncates**, for the same reason as the
 * catalog migration: a truncated SKU in an issue row points the operator at
 * the wrong product, or at no product at all.
 */
export class Migration20260804T152741ProductFeedsWidenIssueSku extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "product_feed_run_issues" alter column "sku" type varchar(255);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      declare
        offending bigint;
      begin
        select count(*) into offending
          from "product_feed_run_issues" where length("sku") > 64;
        if offending > 0 then
          raise exception
            'Cannot narrow product_feed_run_issues.sku to varchar(64): % row(s) hold a longer SKU. Remove those issue rows before reverting this migration — truncating would misidentify the product each issue describes.',
            offending;
        end if;
      end
      $$;
    `);
    this.addSql(
      `alter table "product_feed_run_issues" alter column "sku" type varchar(64);`,
    );
  }
}
