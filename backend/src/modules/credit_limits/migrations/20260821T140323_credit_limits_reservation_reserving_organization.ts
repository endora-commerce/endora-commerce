import { Migration } from '@mikro-orm/migrations';

/**
 * `credit_limit_reservations.reserving_organization_id` — who drew the credit,
 * recorded by this module instead of asked of `orders` (feature 075).
 *
 * The `independent_default` inheritance mode sums "the active reservations this
 * descendant has consumed", and until now the only record of which descendant
 * that was lived in somebody else's table: the sum ran
 * `join orders o on o.id = r.order_id where o.organization_id = ?`, inside the
 * placement transaction, while a `PESSIMISTIC_WRITE` was held on the owning
 * organization's credit row. The value it read is one this module already has
 * in hand — `reserve` is called with the reserving organization, and placement
 * writes the same value onto the order — so the join was buying nothing but a
 * cross-module reach the boundary check had to carry as debt.
 *
 * The backfill is the one place that still needs `orders`, and it is the right
 * place for it: a migration naming another module's table is ordered by the
 * dependency graph (this module declares `orders`, which
 * `credit_limit_reservations_order_fk` already obliges) rather than executed on
 * a hot money path.
 *
 * `not null` holds because that foreign key does: `on delete restrict` against
 * `orders.id` means every reservation row has an order to take the value from.
 */
export class Migration20260821T140323CreditLimitsReservationReservingOrganization extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "credit_limit_reservations" add column "reserving_organization_id" uuid null;`,
    );
    this.addSql(`
      update "credit_limit_reservations" r
         set "reserving_organization_id" = o."organization_id"
        from "orders" o
       where o."id" = r."order_id";
    `);
    this.addSql(
      `alter table "credit_limit_reservations" alter column "reserving_organization_id" set not null;`,
    );
    this.addSql(`
      create index "credit_limit_reservations_reserving_organization_id_index"
        on "credit_limit_reservations" ("reserving_organization_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "credit_limit_reservations_reserving_organization_id_index";`,
    );
    this.addSql(
      `alter table "credit_limit_reservations" drop column "reserving_organization_id";`,
    );
  }
}
