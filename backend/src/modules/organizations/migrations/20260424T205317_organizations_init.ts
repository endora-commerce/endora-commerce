import { Migration } from '@mikro-orm/migrations';

/**
 * Organizations module (+ customer_accounts + addresses) — Phase 4b (T116).
 *
 * Also lands email_verification_tokens used by registration + email change flows.
 * The partial unique index on `addresses (organization_id, kind) WHERE is_default`
 * enforces "at most one default per kind" atomically (T097 contract).
 */
export class Migration20260424T205317OrganizationsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "organizations" (
        "id" uuid not null,
        "name" varchar(255) not null,
        "tax_id" varchar(32) not null,
        "status" varchar(32) not null default 'pending_verification',
        "vat_status" varchar(16) not null default 'vat_payer',
        "registered_address" jsonb not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "organizations_pkey" primary key ("id"),
        constraint "organizations_tax_id_unique" unique ("tax_id")
      );
    `);
    this.addSql('create index "organizations_name_index" on "organizations" ("name");');
    this.addSql('create index "organizations_status_index" on "organizations" ("status");');

    this.addSql(`
      create table "customer_accounts" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "email" varchar(320) not null,
        "password_hash" varchar(512) not null,
        "first_name" varchar(120) not null,
        "last_name" varchar(120) not null,
        "role" varchar(32) not null default 'regular_user',
        "email_verified_at" timestamptz null,
        "two_factor_secret" varchar(64) null,
        "two_factor_confirmed_at" timestamptz null,
        "last_login_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "customer_accounts_pkey" primary key ("id"),
        constraint "customer_accounts_email_unique" unique ("email"),
        constraint "customer_accounts_organization_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict
      );
    `);
    this.addSql('create index "customer_accounts_organization_id_index" on "customer_accounts" ("organization_id");');
    this.addSql('create index "customer_accounts_role_index" on "customer_accounts" ("role");');

    this.addSql(`
      create table "addresses" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "kind" varchar(16) not null,
        "recipient_name" varchar(160) not null,
        "street" varchar(255) not null,
        "city" varchar(120) not null,
        "postal_code" varchar(20) not null,
        "country" varchar(2) not null,
        "phone" varchar(32) null,
        "is_default" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "addresses_pkey" primary key ("id"),
        constraint "addresses_organization_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict
      );
    `);
    this.addSql('create index "addresses_organization_id_index" on "addresses" ("organization_id");');
    this.addSql('create index "addresses_kind_index" on "addresses" ("kind");');
    // At most one default per (organization, kind) — partial unique index.
    this.addSql(
      `create unique index "addresses_one_default_per_kind" on "addresses" ("organization_id", "kind") where "is_default" = true and "deleted_at" is null;`,
    );

    this.addSql(`
      create table "email_verification_tokens" (
        "id" uuid not null,
        "customer_account_id" uuid not null,
        "token_hash" varchar(128) not null,
        "expires_at" timestamptz not null,
        "consumed_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "email_verification_tokens_pkey" primary key ("id"),
        constraint "email_verification_tokens_token_hash_unique" unique ("token_hash"),
        constraint "email_verification_tokens_customer_fk" foreign key ("customer_account_id")
          references "customer_accounts" ("id") on delete cascade
      );
    `);
    this.addSql('create index "email_verification_tokens_customer_account_id_index" on "email_verification_tokens" ("customer_account_id");');
    this.addSql('create index "email_verification_tokens_expires_at_index" on "email_verification_tokens" ("expires_at");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "email_verification_tokens" cascade;');
    this.addSql('drop table if exists "addresses" cascade;');
    this.addSql('drop table if exists "customer_accounts" cascade;');
    this.addSql('drop table if exists "organizations" cascade;');
  }
}
