import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 040 (Customers) — extends `customer_accounts` with the lifecycle
 * fields the Customers module needs:
 *
 *  - `customer_group_id` — direct customer→customer-group membership (FR-022),
 *    FK to `customer_groups` (owned by price_lists) ON DELETE SET NULL.
 *  - block state + provenance (`blocked_at`, `block_reason`, `block_source`,
 *    `blocked_by_admin_user_id`, `blocked_by_customer_account_id`) — FR-012…017.
 *  - deletion / anonymization state (`deletion_requested_by_admin_user_id`,
 *    `anonymized_at`) paired with the existing `deleted_at` — FR-039/FR-040.
 *
 * All columns are nullable; existing rows are unaffected.
 */
export class Migration060CustomerAccountsLifecycle extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "customer_accounts"
      add column "customer_group_id" uuid null,
      add column "blocked_at" timestamptz null,
      add column "block_reason" text null,
      add column "block_source" varchar(16) null,
      add column "blocked_by_admin_user_id" uuid null,
      add column "blocked_by_customer_account_id" uuid null,
      add column "deletion_requested_by_admin_user_id" uuid null,
      add column "anonymized_at" timestamptz null;`);

    this.addSql(`alter table "customer_accounts"
      add constraint "customer_accounts_customer_group_fk"
      foreign key ("customer_group_id") references "customer_groups" ("id")
      on update cascade on delete set null;`);

    this.addSql(
      `create index "customer_accounts_customer_group_id_index" on "customer_accounts" ("customer_group_id");`,
    );
    this.addSql(
      `create index "customer_accounts_blocked_at_index" on "customer_accounts" ("blocked_at");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_accounts"
      drop constraint if exists "customer_accounts_customer_group_fk";`);
    this.addSql(`drop index if exists "customer_accounts_customer_group_id_index";`);
    this.addSql(`drop index if exists "customer_accounts_blocked_at_index";`);
    this.addSql(`alter table "customer_accounts"
      drop column if exists "customer_group_id",
      drop column if exists "blocked_at",
      drop column if exists "block_reason",
      drop column if exists "block_source",
      drop column if exists "blocked_by_admin_user_id",
      drop column if exists "blocked_by_customer_account_id",
      drop column if exists "deletion_requested_by_admin_user_id",
      drop column if exists "anonymized_at";`);
  }
}
