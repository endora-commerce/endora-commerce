import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 058 — Credentials module (init).
 *
 * Creates `credential_configurations` — reusable, named instances of a
 * code-registered configuration type. Secret field values are stored as
 * AES-256-GCM envelopes inside the `values` JSONB bag; the type/provider codes
 * are resolved against the in-process registry (no DB-level FK).
 *
 * `code` is globally unique (stable reference target). `type_code` is indexed
 * for the "list by type" picker query.
 */
export class Migration099CredentialsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "credential_configurations" (
        "id" uuid not null,
        "code" varchar(128) not null,
        "name" varchar(255) not null,
        "type_code" varchar(64) not null,
        "provider_code" varchar(64) not null,
        "values" jsonb not null default '{}',
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "credential_configurations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "credential_configurations" add constraint "credential_configurations_code_unique" unique ("code");`,
    );
    this.addSql(
      `create index "credential_configurations_type_code_idx" on "credential_configurations" ("type_code");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "credential_configurations" cascade;`);
  }
}
