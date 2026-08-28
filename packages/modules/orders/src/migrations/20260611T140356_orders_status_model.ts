import { Migration } from '@mikro-orm/migrations';
import { randomUUID } from 'crypto';
import {
  DEFAULT_ORDER_STATUSES,
  computeDefaultTransitions,
} from '../backend/domain/order-status-graph.js';

/**
 * Feature 038 (US1) — configurable order lifecycle.
 *
 * Creates the data-driven status graph (`order_statuses` +
 * `order_status_transitions`), seeds the 9 default statuses and their
 * predefined + universal (on_hold/cancelled) transitions, and widens
 * `orders.status` from the legacy fixed enum (varchar(32)) to a configurable
 * status code (varchar(64)). The default codes are seeded from the single
 * source of truth in `domain/order-status-graph.ts`.
 *
 * The platform has no production data yet, so legacy order rows are remapped
 * in place (confirmed→paid, in_fulfilment→processing, shipped→shipment_sent;
 * new/completed/cancelled unchanged) without a compatibility shim.
 */
export class Migration20260611T140356OrdersStatusModel extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "order_statuses" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "is_initial" boolean not null default false,
        "is_terminal" boolean not null default false,
        "is_system" boolean not null default false,
        "weight" int not null default 100,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "order_statuses_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "order_statuses" add constraint "order_statuses_code_unique" unique ("code");`);

    this.addSql(`
      create table "order_status_transitions" (
        "id" uuid not null,
        "from_status_code" varchar(64) not null,
        "to_status_code" varchar(64) not null,
        "is_system" boolean not null default false,
        "created_at" timestamptz not null,
        constraint "order_status_transitions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "order_status_transitions" add constraint "order_status_transitions_pair_unique" unique ("from_status_code", "to_status_code");`,
    );
    this.addSql(`create index "order_status_transitions_from_idx" on "order_status_transitions" ("from_status_code");`);

    // Seed the default statuses (single source of truth: domain module).
    for (const s of DEFAULT_ORDER_STATUSES) {
      this.addSql(
        `insert into "order_statuses" ("id", "code", "name", "is_initial", "is_terminal", "is_system", "weight", "created_at", "updated_at") ` +
          `values ('${randomUUID()}', '${s.code}', '${jsonLiteral(s.name)}'::jsonb, ${s.isInitial}, ${s.isTerminal}, ${s.isSystem}, ${s.weight}, now(), now());`,
      );
    }
    // Seed explicit + universal transitions.
    for (const t of computeDefaultTransitions()) {
      this.addSql(
        `insert into "order_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at") ` +
          `values ('${randomUUID()}', '${t.fromStatusCode}', '${t.toStatusCode}', ${t.isSystem}, now());`,
      );
    }

    // Widen orders.status and remap the legacy codes to the new default set.
    this.addSql(`alter table "orders" alter column "status" type varchar(64);`);
    this.addSql(`update "orders" set "status" = 'paid' where "status" = 'confirmed';`);
    this.addSql(`update "orders" set "status" = 'processing' where "status" = 'in_fulfilment';`);
    this.addSql(`update "orders" set "status" = 'shipment_sent' where "status" = 'shipped';`);
  }

  override async down(): Promise<void> {
    // Reverse the remap and narrow the column.
    this.addSql(`update "orders" set "status" = 'shipped' where "status" = 'shipment_sent';`);
    this.addSql(`update "orders" set "status" = 'in_fulfilment' where "status" = 'processing';`);
    this.addSql(`update "orders" set "status" = 'confirmed' where "status" = 'paid';`);
    this.addSql(
      `update "orders" set "status" = 'new' where "status" not in ('new', 'confirmed', 'in_fulfilment', 'shipped', 'completed', 'cancelled');`,
    );
    this.addSql(`alter table "orders" alter column "status" type varchar(32);`);
    this.addSql(`drop table if exists "order_status_transitions";`);
    this.addSql(`drop table if exists "order_statuses";`);
  }
}

/** Escape single quotes for a JSON literal embedded in a SQL string. */
function jsonLiteral(obj: unknown): string {
  return JSON.stringify(obj).replace(/'/g, "''");
}
