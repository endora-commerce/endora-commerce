import { Migration } from '@mikro-orm/migrations';

/**
 * `credit_limit_reservations.order_id` gains the foreign key it never had
 * (D-94.1, site 4 — the site the D-94 sweep found, of exactly the shape D-90
 * repaired for `shipments.order_id`).
 *
 * `CreditLimitService.reserve({ tx })` is called from `placeOrder` with the
 * placement `EntityManager`, so the `PESSIMISTIC_WRITE` on the organization's
 * `credit_limits` row — or the owning ancestor's row, taken with
 * `select … for update` — is held until placement commits. A separate
 * transaction would leave credit consumed for an order that rolled back:
 * `stock_allocations`' argument, in money. D-78 point 2 rules such a seam
 * permanent and *declared*, and what makes the declaration honest is a
 * constraint. The omission tracks the module boundary and nothing else — the
 * same `create table` (`20260425T063333_credit_limits_init.ts:34-48`) declares
 * `credit_limit_reservations_credit_limit_fk` on `credit_limit_id` and leaves
 * `order_id` bare.
 *
 * `on delete restrict`: a reservation row is one half of a counter. Deleting
 * an order under `cascade` would drop the reservation while the credit stays
 * drawn. `restrict` says the only correct thing — release it first.
 *
 * The column accepted unconstrained values from 2026-04-25 until this
 * migration, so the constraint is preceded by an explicit orphan report. Any
 * orphan with `status = 'active'` has been silently consuming an
 * organization's available credit, and `releaseByOrder` — which looks the
 * reservation up **by order id** — cannot reach it. Export first (it is a
 * money record), then delete; releasing rather than deleting does not satisfy
 * the constraint, because the row still names a missing order. If the locked
 * amount is non-zero, tell the organization's owner what their available
 * credit was and what it now is: this is a customer-facing correction, not a
 * schema chore (D-94.2, remedy 3).
 *
 * `credit_limits` declares `orders` in its manifest `dependencies` for this
 * edge (AGENTS.md § Migrations item 4). The reverse port edge — `orders`
 * resolving `creditLimitService` — moves to `acknowledgedDependencies`, which
 * drops the install ordering the constraint says is backwards and keeps every
 * refusal exactly as it was (D-94.3).
 */
export class Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        orphan_count bigint;
        amount_locked numeric(14,2);
        sample text;
      begin
        select count(*),
               coalesce(sum(r."amount") filter (where r."status" = 'active'), 0)
          into orphan_count, amount_locked
          from "credit_limit_reservations" r
          left join "orders" o on o."id" = r."order_id"
         where o."id" is null;

        if orphan_count > 0 then
          select string_agg(x."order_id"::text, ', ') into sample
            from (
              select distinct r."order_id"
                from "credit_limit_reservations" r
                left join "orders" o on o."id" = r."order_id"
               where o."id" is null
               limit 10
            ) x;
          raise exception
            'credit_limit_reservations_order_fk cannot be added: % orphaned credit_limit_reservations.order_id value(s) reference no orders row, holding % in still-active reservations releaseByOrder cannot reach (first ten: %). Export those money records, delete them, tell each affected organization what their available credit was and what it now is, then re-run the migration.',
            orphan_count, amount_locked, sample;
        end if;
      end $$;
    `);

    this.addSql(`
      alter table "credit_limit_reservations"
        add constraint "credit_limit_reservations_order_fk" foreign key ("order_id")
          references "orders" ("id") on delete restrict;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "credit_limit_reservations" drop constraint if exists "credit_limit_reservations_order_fk";`,
    );
  }
}
