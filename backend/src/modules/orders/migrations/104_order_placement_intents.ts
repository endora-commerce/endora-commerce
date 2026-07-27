import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 062 — durable order-intake idempotency (data-model.md §2).
 *
 * Creates `order_placement_intents`, owned by the orders module:
 *  - UNIQUE `(api_key_id, idempotency_key)` — the idempotency guarantee
 *    (FR-012); insert races resolve at this index.
 *  - `organization_id` denormalized from the bound key at insert — the tenant
 *    key (Principle XI); indexed with `created_at` for ops queries.
 *  - `api_key_id` cascades on key deletion (revocation keeps rows);
 *    `order_id` is nulled when the order is removed.
 */
export class Migration104OrderPlacementIntents extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "order_placement_intents" (
        "id" uuid not null,
        "api_key_id" uuid not null,
        "organization_id" uuid not null,
        "idempotency_key" varchar(128) not null,
        "payload_fingerprint" char(64) not null,
        "status" varchar(16) not null default 'pending',
        "order_id" uuid null,
        "last_error" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "order_placement_intents_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "order_placement_intents"
        add constraint "order_placement_intents_api_key_id_foreign"
          foreign key ("api_key_id") references "api_keys" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "order_placement_intents"
        add constraint "order_placement_intents_organization_id_foreign"
          foreign key ("organization_id") references "organizations" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "order_placement_intents"
        add constraint "order_placement_intents_order_id_foreign"
          foreign key ("order_id") references "orders" ("id")
          on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "order_placement_intents"
        add constraint "order_placement_intents_api_key_id_idempotency_key_unique"
          unique ("api_key_id", "idempotency_key");
    `);
    this.addSql(`
      create index "order_placement_intents_organization_id_created_at_index"
        on "order_placement_intents" ("organization_id", "created_at");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_placement_intents" cascade;`);
  }
}
