import { Migration } from '@mikro-orm/migrations';

/**
 * `shipments.order_id` gains the foreign key it never had (D-90).
 *
 * `receive-shipment-handler.ts` moves the shipment row and the order's status
 * inside one `em.transactional`, so a carrier callback records both or neither.
 * D-78 point 2 rules such a seam permanent — kept on the caller's
 * `EntityManager` and *declared* — and what makes the declaration honest is a
 * constraint. `payments` has carried exactly that since the core commerce init
 * (`payments_order_fk`, `on delete restrict`); this column was created with a
 * primary key, a status check and two indexes and no constraint at all
 * (`delivery_methods/migrations/20260611T140354_…`, which is also why the module
 * that owns the entity has never owned its schema).
 *
 * `on delete restrict` for the same reason `payments` uses it: an order with
 * shipments against it is not a row anyone should be able to delete out from
 * under them.
 *
 * The table accepted unconstrained `order_id`s from 2026-06-11 until this
 * migration, so the constraint is preceded by an explicit orphan report. An
 * operator whose data has orphans gets a sentence naming the count and the
 * first ten values, not a bare `23503` from Postgres — the orphans are a data
 * question with a name, not a migration that will not apply.
 *
 * `shipments` already declares `orders` in its manifest `dependencies`, so this
 * adds no edge to the module graph and nothing to the migration order.
 */
export class Migration20260817T194652ShipmentsOrderFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        orphan_count bigint;
        sample text;
      begin
        select count(*) into orphan_count
          from "shipments" s
          left join "orders" o on o."id" = s."order_id"
         where o."id" is null;

        if orphan_count > 0 then
          select string_agg(x."order_id"::text, ', ') into sample
            from (
              select distinct s."order_id"
                from "shipments" s
                left join "orders" o on o."id" = s."order_id"
               where o."id" is null
               limit 10
            ) x;
          raise exception
            'shipments_order_fk cannot be added: % orphaned shipments.order_id value(s) reference no orders row (first ten: %). Delete those shipments or restore the missing orders, then re-run the migration.',
            orphan_count, sample;
        end if;
      end $$;
    `);

    this.addSql(`
      alter table "shipments"
        add constraint "shipments_order_fk" foreign key ("order_id")
          references "orders" ("id") on delete restrict;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_order_fk";`);
  }
}
