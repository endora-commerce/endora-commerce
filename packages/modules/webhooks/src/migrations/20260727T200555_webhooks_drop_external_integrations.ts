import { Migration } from '@mikro-orm/migrations';

/**
 * Drops `external_integrations` together with the removal of the
 * `integrations` module.
 *
 * The module was scaffolding that never grew a consumer: no adapter registry
 * was ever built, nothing decrypted `encrypted_config` outside its own
 * service, and its role is covered by `credentials` (encrypted vendor
 * credentials referenced from Settings), `api_keys` (inbound machine access),
 * `webhooks` (outbound notifications), and the per-vendor integration modules.
 *
 * The table lives here rather than in an `integrations` migration directory
 * because `009_us7_init.ts` — which also creates `webhooks` and
 * `webhook_deliveries` — is what created it. That migration has already run in
 * production, and what follows from that is that its class name cannot move,
 * not that its body cannot change: the storage persists the name and no
 * checksum, so an edited body is never re-offered.
 * `specs/120-migration-closure-bridge-ownership/` Phase 3 took the `api_keys`
 * creation out of it on exactly that reasoning.
 *
 * `down()` recreates the table exactly as `009_us7_init.ts` left it, so a
 * rollback restores the schema. Row data is not recoverable.
 */
export class Migration20260727T200555WebhooksDropExternalIntegrations extends Migration {
  override async up(): Promise<void> {
    this.addSql('drop table if exists "external_integrations" cascade;');
  }

  override async down(): Promise<void> {
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
}
