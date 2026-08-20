import { Migration } from '@mikro-orm/migrations';

/**
 * `promotion_usages.order_id` gains the foreign key it never had (D-94.1,
 * site 3 — the family D-90 opened with `shipments.order_id`).
 *
 * `PromotionService.finalizeUsage(em, …)` runs on the *placement*
 * `EntityManager`: a usage cap hit at the last moment throws and rolls the
 * order back with it. D-78 point 2 rules such a seam permanent and *declared*,
 * and what makes the declaration honest is a constraint. `promotion_usages`
 * was created (`20260618T100727_promotions_engine.ts:98-116`) with a primary
 * key, a `(order_id, promotion_id)` unique constraint and two indexes, and no
 * foreign key on any column — so the omission tracks the module boundary, not
 * a decision about money.
 *
 * `on delete restrict`: a usage row is one half of a counter. Deleting an
 * order under `cascade` would drop the redemption while
 * `promotion_usage_counters` keeps the increment, so the cap would silently
 * drift. `restrict` says the only correct thing — release it first.
 *
 * The column accepted unconstrained values from 2026-06-18 until this
 * migration, so the constraint is preceded by an explicit orphan report.
 * Rows returned mean a redemption recorded against an order that is gone.
 * Delete them — and **accept that `promotion_usage_counters` will now
 * over-count, deliberately**. Deriving the decrement means re-deriving
 * `buildGuards`' scope choice (`per_coupon` vs `shared_batch`, per
 * organization, per customer) from configuration that may have changed since
 * the redemption, in SQL, against money-adjacent state. An over-counted cap
 * fails **closed**: a coupon retires early and an operator raises the limit.
 * That is the safe direction, and it is recorded here so the next reader knows
 * it was chosen rather than missed (D-94.2, remedy 2).
 *
 * `promotions` declares `orders` in its manifest `dependencies` for this edge
 * (AGENTS.md § Migrations item 4). The reverse port edge — `orders` resolving
 * `promotionService` — moves to `acknowledgedDependencies` in `orders` and in
 * `carts`, which drops the install ordering the constraint says is backwards
 * and keeps every refusal exactly as it was (D-94.3).
 */
export class Migration20260818T081251PromotionsPromotionUsageOrderFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        orphan_count bigint;
        sample text;
      begin
        select count(*) into orphan_count
          from "promotion_usages" u
          left join "orders" o on o."id" = u."order_id"
         where o."id" is null;

        if orphan_count > 0 then
          select string_agg(x."order_id"::text, ', ') into sample
            from (
              select distinct u."order_id"
                from "promotion_usages" u
                left join "orders" o on o."id" = u."order_id"
               where o."id" is null
               limit 10
            ) x;
          raise exception
            'promotion_usages_order_fk cannot be added: % orphaned promotion_usages.order_id value(s) reference no orders row (first ten: %). Export and delete those redemptions; promotion_usage_counters is left over-counting on purpose, which retires a coupon early rather than letting it be redeemed past its cap. Then re-run the migration.',
            orphan_count, sample;
        end if;
      end $$;
    `);

    this.addSql(`
      alter table "promotion_usages"
        add constraint "promotion_usages_order_fk" foreign key ("order_id")
          references "orders" ("id") on delete restrict;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "promotion_usages" drop constraint if exists "promotion_usages_order_fk";`,
    );
  }
}
