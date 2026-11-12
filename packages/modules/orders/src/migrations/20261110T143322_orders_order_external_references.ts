import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #1030 — `order_external_references`: what one external system (an
 * ERP, a WMS, a fulfilment connector) last reported about one order — its own
 * number for it, where the hand-over stands and its words on a refusal.
 * Written only through `orderExternalReferencePort`.
 *
 *  - UNIQUE `(order_id, system)` — one entry per order and system; a write
 *    updates it in place.
 *  - `(system, reference)` — the reverse lookup a writer makes with the number
 *    the other system answers with (`findOrderIds`).
 *  - `state` is a closed set held by a check constraint, as the contract's
 *    `ORDER_EXTERNAL_REFERENCE_STATES` is; `system`, `reference` and `message`
 *    are bounded by the contract's own limits.
 *  - `organization_id` is copied from the order at insert — the tenant key
 *    (Principle XI) — and, as on `order_transition_effects`, carries no
 *    foreign key of its own: `orders.organization_id` carries none either.
 *  - `order_id` cascades: an entry is about its order and nothing else.
 *  - `system` references nothing. A system whose module is uninstalled leaves
 *    its entries in place, as history.
 *
 * Own table only (`module-migrations.md` item 4a). Created empty.
 */
export class Migration20261110T143322OrdersOrderExternalReferences extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "order_external_references" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "order_id" uuid not null,
        "system" text not null,
        "reference" text null,
        "state" text not null,
        "message" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "order_external_references_pkey" primary key ("id"),
        constraint "order_external_references_order_system_unique" unique ("order_id", "system"),
        constraint "order_external_references_state_check"
          check ("state" in ('pending', 'synced', 'error')),
        constraint "order_external_references_system_check"
          check (char_length("system") between 1 and 64),
        constraint "order_external_references_reference_check"
          check ("reference" is null or char_length("reference") between 1 and 255),
        constraint "order_external_references_message_check"
          check ("message" is null or char_length("message") <= 1000),
        constraint "order_external_references_order_id_foreign"
          foreign key ("order_id") references "orders" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "order_external_references_system_reference_index"
        on "order_external_references" ("system", "reference");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_external_references" cascade;`);
  }
}
