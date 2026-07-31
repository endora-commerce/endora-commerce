import { Migration } from '@mikro-orm/migrations';

/**
 * US7 surface — Phase 9 (T225). Lands api_keys + webhooks + webhook_deliveries
 * + external_integrations.
 */
export class Migration20260425T091359WebhooksUs7Init extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "api_keys" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "key_hash" varchar(128) not null,
        "last_four" varchar(8) not null,
        "scopes" jsonb not null default '[]'::jsonb,
        "status" varchar(16) not null default 'active',
        "last_used_at" timestamptz null,
        "revoked_at" timestamptz null,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "api_keys_pkey" primary key ("id"),
        constraint "api_keys_key_hash_unique" unique ("key_hash")
      );
    `);
    this.addSql('create index "api_keys_key_hash_index" on "api_keys" ("key_hash");');

    this.addSql(`
      create table "webhooks" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "url" varchar(2048) not null,
        "secret" varchar(128) not null,
        "event_types" jsonb not null default '[]'::jsonb,
        "status" varchar(16) not null default 'active',
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "webhooks_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "webhooks_status_index" on "webhooks" ("status");');

    this.addSql(`
      create table "webhook_deliveries" (
        "id" uuid not null,
        "webhook_id" uuid not null,
        "event_id" varchar(64) not null,
        "event_type" varchar(64) not null,
        "payload" jsonb not null,
        "status" varchar(16) not null default 'pending',
        "attempt_count" int not null default 0,
        "dispatched_at" timestamptz null,
        "last_response_status" int null,
        "last_response_body" varchar(4000) null,
        "last_error" varchar(4000) null,
        "completed_at" timestamptz null,
        "dead_lettered_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "webhook_deliveries_pkey" primary key ("id"),
        constraint "webhook_deliveries_webhook_fk" foreign key ("webhook_id")
          references "webhooks" ("id") on delete cascade
      );
    `);
    this.addSql('create index "webhook_deliveries_webhook_id_index" on "webhook_deliveries" ("webhook_id");');
    this.addSql('create index "webhook_deliveries_event_id_index" on "webhook_deliveries" ("event_id");');
    this.addSql('create index "webhook_deliveries_event_type_index" on "webhook_deliveries" ("event_type");');
    this.addSql('create index "webhook_deliveries_status_index" on "webhook_deliveries" ("status");');

    this.addSql(`
      create table "external_integrations" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "vendor" varchar(64) not null,
        "kind" varchar(32) not null,
        "encrypted_config" text not null,
        "status" varchar(16) not null default 'inactive',
        "last_tested_at" timestamptz null,
        "last_error" varchar(4000) null,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "external_integrations_pkey" primary key ("id"),
        constraint "external_integrations_vendor_unique" unique ("vendor")
      );
    `);
    this.addSql('create index "external_integrations_vendor_index" on "external_integrations" ("vendor");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "external_integrations" cascade;');
    this.addSql('drop table if exists "webhook_deliveries" cascade;');
    this.addSql('drop table if exists "webhooks" cascade;');
    this.addSql('drop table if exists "api_keys" cascade;');
  }
}
