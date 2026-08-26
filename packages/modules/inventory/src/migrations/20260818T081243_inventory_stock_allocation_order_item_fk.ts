import { Migration } from '@mikro-orm/migrations';

/**
 * `stock_allocations.order_item_id` gains the foreign key it never had
 * (D-94.1, site 1 — the family D-90 opened with `shipments.order_id`).
 *
 * `placeOrder` locks `stock_levels` under `PESSIMISTIC_WRITE`, increments
 * `reserved` and inserts one `stock_allocations` row per (order item,
 * warehouse) — all on the placement `EntityManager`, so a placement that then
 * fails releases the reservation by rolling back. D-78 point 2 rules such a
 * seam permanent and *declared*, and what makes the declaration honest is a
 * constraint. The omission was never a decision: the same `create table`
 * (`20260503T182812_inventory_workflow.ts:199-211`) constrains `warehouse_id`
 * with `sa_warehouse_fk` and leaves `order_item_id` — same statement, same
 * `not null` shape, carrying the unique index — bare. It tracks the module
 * boundary, nothing else.
 *
 * `on delete restrict`, for a sharper reason than symmetry with `payments`:
 * an allocation row is one half of a counter. Deleting an `order_items` row
 * under `cascade` would drop its allocations and leave `stock_levels.reserved`
 * overcounted for ever. `restrict` says the only correct thing — release it
 * first.
 *
 * The column accepted unconstrained values from 2026-05-03 until this
 * migration, so the constraint is preceded by an explicit orphan report:
 * an operator whose data has orphans gets a sentence naming the count, the
 * reserved units at stake and the first ten values, not a bare `23503`.
 * Rows returned mean stock is reserved for a line that no longer exists and
 * no code path will ever release it. Remedy, in order: export the rows,
 * delete them, and — because `stock_allocations` carries no product or
 * variant — recompute `stock_levels.reserved` from the surviving allocations
 * in a maintenance window (the query is in
 * `specs/077-f3-consequence-rulings/co-transactional-fk-family.md` § D-94.2).
 * Do not run the recompute blind: a deployment with no orphans does not need
 * it, and it is the one step that touches rows the defect did not.
 *
 * `inventory` declares `orders` in its manifest `dependencies` for this edge
 * (AGENTS.md § Migrations item 4). It is the one constraint of the four that
 * closes no cycle.
 */
export class Migration20260818T081243InventoryStockAllocationOrderItemFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        orphan_count bigint;
        reserved_units bigint;
        sample text;
      begin
        select count(*),
               coalesce(sum(a."quantity") filter (where a."released_at" is null), 0)
          into orphan_count, reserved_units
          from "stock_allocations" a
          left join "order_items" oi on oi."id" = a."order_item_id"
         where oi."id" is null;

        if orphan_count > 0 then
          select string_agg(x."order_item_id"::text, ', ') into sample
            from (
              select distinct a."order_item_id"
                from "stock_allocations" a
                left join "order_items" oi on oi."id" = a."order_item_id"
               where oi."id" is null
               limit 10
            ) x;
          raise exception
            'stock_allocations_order_item_fk cannot be added: % orphaned stock_allocations.order_item_id value(s) reference no order_items row, holding % reserved unit(s) no code path will release (first ten: %). Export and delete those allocations, then recompute stock_levels.reserved from the surviving ones, then re-run the migration.',
            orphan_count, reserved_units, sample;
        end if;
      end $$;
    `);

    this.addSql(`
      alter table "stock_allocations"
        add constraint "stock_allocations_order_item_fk" foreign key ("order_item_id")
          references "order_items" ("id") on delete restrict;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "stock_allocations" drop constraint if exists "stock_allocations_order_item_fk";`,
    );
  }
}
