import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 040 (Customers) — extends `customer_accounts` with the lifecycle
 * fields the Customers module needs:
 *
 *  - `customer_group_id` — direct customer→customer-group membership (FR-022),
 *    FK to `customer_groups` ON DELETE SET NULL.
 *  - block state + provenance (`blocked_at`, `block_reason`, `block_source`,
 *    `blocked_by_admin_user_id`, `blocked_by_customer_account_id`) — FR-012…017.
 *  - deletion / anonymization state (`deletion_requested_by_admin_user_id`,
 *    `anonymized_at`) paired with the existing `deleted_at` — FR-039/FR-040.
 *
 * All columns are nullable; existing rows are unaffected.
 *
 * **It also creates `customer_groups` since
 * `specs/120-migration-closure-bridge-ownership/` Phase 3.** The table was
 * created by `price_lists`' frozen
 * `Migration20260426T075235PriceListsPricingInit` while this module owns it —
 * its `CustomerGroup` entity declares the table name — because tiered pricing
 * needed customer groups first and created them where it needed them.
 * The table was created by whoever needed it first rather than by whoever owns
 * it, and the comment above used to record that as *"owned by price_lists"*.
 *
 * **Why this site is repaired while 27 other misfiled creations are not.**
 * Moving a *reference* into its owner's module can only move it strictly later
 * in the computed order, which is always safe; moving a *creation* moves it to
 * a position every existing reference must be re-checked against. The other 27
 * fail **safe** — a client omitting `catalog` gets an empty `products` table.
 * This one also produced a fail-**closed** reference: the foreign key below
 * named a table outside this module's closure, and declaring `price_lists`
 * here to fix that would close a cycle, `price_lists` already declaring
 * `customer_accounts`. That, and nothing else, is why it is on the list
 * (owner's ruling, 2026-09-12).
 *
 * **The re-check, derived from the computed order rather than from a stamp.**
 * The only reference to `customer_groups` in the entire corpus is this
 * migration's own foreign key, three statements below. `price_lists` does not
 * reference it: `price_list_assignments.customer_group_id` is a nullable column
 * with an index and no foreign key, and so is `organizations.customer_group_id`.
 * So the creation is placed in the frozen body that carries the only reference,
 * above it, and every position in between is unaffected.
 *
 * **`if not exists`, and it is load-bearing.** A database that applied the
 * April migration and has not yet reached this one already has the table while
 * this migration is pending; a verbatim `create table` would fail there. Both
 * class names are unchanged and `BASELINE_MIGRATIONS` is untouched —
 * `mikro_orm_migrations` persists the class name and no checksum, so neither
 * edited body is re-offered to a database that has applied it.
 */
export class Migration20260611T140403CustomerAccountsLifecycle extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "customer_groups" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "description" varchar(1000) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "customer_groups_pkey" primary key ("id"),
        constraint "customer_groups_code_unique" unique ("code")
      );
    `);

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
    this.addSql('drop table if exists "customer_groups" cascade;');
  }
}
