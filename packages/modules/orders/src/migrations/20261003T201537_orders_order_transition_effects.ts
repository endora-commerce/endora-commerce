import { Migration } from '@mikro-orm/migrations';

/**
 * `order_transition_effects` — the follow-ups an order transition owes
 * (`specs/142-order-transition-atomicity/`, data model).
 *
 * One row per release a transition has to perform: the stock release and the
 * credit-limit release of a cancellation, the credit-limit release of an order
 * marked paid. The row is written in the transaction that writes the status
 * and stays until the release has completed, so what an order still owes is
 * data rather than a step a request was about to take.
 *
 *  - `effect`, `reason` and `origin` are closed sets, held by check
 *    constraints: a row nothing knows how to execute would be retried forever.
 *  - UNIQUE `(order_id, effect) where completed_at is null` — at most one
 *    **outstanding** row per order and effect. A completed row does not block a
 *    later one, which is what lets a deployment whose status graph leaves
 *    `cancelled` and returns to it owe the release again.
 *  - `(next_attempt_at) where completed_at is null` — the sweep's read: only
 *    outstanding rows are in it, so completed history costs it nothing.
 *  - `(order_id)` — the order page.
 *  - `claimed_until` is the lease of whoever is attempting the row right now:
 *    a committed timestamp rather than a row lock, so an attempt holds no
 *    database connection while the owner's release runs, and a lease nobody
 *    hands back simply expires.
 *  - `organization_id` is copied from the order at insert — the tenant key
 *    (Principle XI). It carries **no foreign key of its own**, deliberately:
 *    `orders.organization_id` carries none either, and a row here is tied to
 *    its order by `order_id`. A constraint on the copy would refuse a
 *    follow-up for an order the schema itself accepts — which, on this path,
 *    means refusing the cancellation that owes it.
 *  - `order_id` cascades: a release is owed *by* an order, and the two owners'
 *    own `on delete restrict` constraints already refuse to delete an order
 *    that still holds stock or credit.
 *
 * The table is created empty. Orders stranded before this migration are not
 * backfilled here — repairing them changes reserved-stock counters and
 * available credit, so it is an operator command with a dry run
 * (`orders transition-effects-repair`), never a side effect of an upgrade.
 */
export class Migration20261003T201537OrdersOrderTransitionEffects extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "order_transition_effects" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "order_id" uuid not null,
        "effect" text not null,
        "reason" text not null,
        "origin" text not null,
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz not null default now(),
        "blocked_on" text null,
        "last_error" text null,
        "last_attempt_at" timestamptz null,
        "result" jsonb null,
        "completed_at" timestamptz null,
        "claimed_until" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "order_transition_effects_pkey" primary key ("id"),
        constraint "order_transition_effects_effect_check"
          check ("effect" in ('stock.release', 'credit.release')),
        constraint "order_transition_effects_reason_check"
          check ("reason" in ('order_cancelled', 'invoice_paid')),
        constraint "order_transition_effects_origin_check"
          check ("origin" in ('transition', 'repair'))
      );
    `);
    this.addSql(`
      alter table "order_transition_effects"
        add constraint "order_transition_effects_order_id_foreign"
          foreign key ("order_id") references "orders" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(`
      create unique index "order_transition_effects_outstanding_unique"
        on "order_transition_effects" ("order_id", "effect")
        where "completed_at" is null;
    `);
    this.addSql(`
      create index "order_transition_effects_due_index"
        on "order_transition_effects" ("next_attempt_at")
        where "completed_at" is null;
    `);
    this.addSql(`
      create index "order_transition_effects_order_id_index"
        on "order_transition_effects" ("order_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_transition_effects" cascade;`);
  }
}
