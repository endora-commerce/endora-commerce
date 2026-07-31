import { Migration } from '@mikro-orm/migrations';

/**
 * Carts consolidation (feature 027).
 *
 * Brings the foundation `carts` table up to the spec defined in feature
 * 027-carts: status lifecycle (active / abandoned / completed / rejected),
 * sales-channel scoping, last-activity bookkeeping for the abandonment
 * sweep, the orthogonal approval sub-state (not_required / pending /
 * approved / rejected_by_org_admin), a coupon-code column wired to the
 * Promotions module, a conversion-lineage column to the Quote Requests
 * module, an abandonment-notification idempotency timestamp, and an
 * optimistic-lock `version` column shared with feature 003 / 026.
 *
 * `cart_items` gains a two-layer pricing snapshot: the existing
 * `unit_price` remains the price the line was added at, while
 * `recomputed_unit_price` / `recomputed_at` / `recomputed_currency` cache
 * the most recent re-resolved price (per feature 011's PricingService).
 *
 * `organizations` gains `requires_cart_approval` — the per-Organization
 * policy flag that gates checkout behind an Organization Administrator's
 * approval. Default false preserves the prior behaviour.
 *
 * Introduces one new table:
 *   - cart_audit_entries — typed per-cart audit feed for the cart-detail
 *     UI (the platform-wide audit timeline still uses audit_log_entries).
 *
 * Data migration: legacy `status='converted'` rows are remapped to
 * `status='completed'`. The legacy unique partial index
 * `carts_one_active_per_customer` (introduced by feature 001) is dropped
 * and replaced with `carts_one_active_per_customer_per_channel` so the
 * "one active cart per (Customer, Sales Channel)" rule from the spec is
 * enforced at the database layer.
 *
 * Settings (`carts.abandonment.inactivity_minutes`,
 * `carts.abandonment.notification_recipient`) are seeded by the module
 * lifecycle reconciler from the `settings` declaration in
 * `carts/manifest.ts` — not from this migration.
 */
export class Migration20260611T140352CartsConsolidation extends Migration {
  override async up(): Promise<void> {
    // 1) Data backfill: rename legacy 'converted' → 'completed' before the
    //    new CHECK constraint is installed. Foundation code that wrote
    //    'converted' (CartService.clearForCustomer) is updated to write
    //    'completed' in the same PR.
    this.addSql(`update "carts" set "status" = 'completed' where "status" = 'converted';`);

    // 2) New columns on `carts`.
    this.addSql(`
      alter table "carts"
        add column "sales_channel_id" uuid null,
        add column "last_activity_at" timestamptz not null default now(),
        add column "approval_status" varchar(32) not null default 'not_required',
        add column "submitted_for_approval_at" timestamptz null,
        add column "approved_at" timestamptz null,
        add column "approved_by_customer_account_id" uuid null,
        add column "rejected_at" timestamptz null,
        add column "rejected_by_actor" varchar(48) null,
        add column "rejected_reason" text null,
        add column "applied_promotion_code" varchar(64) null,
        add column "converted_to_quote_request_id" uuid null,
        add column "abandonment_notified_at" timestamptz null,
        add column "version" int not null default 0;
    `);

    // 3) CHECK constraints for the two enum-like columns.
    this.addSql(`
      alter table "carts"
        add constraint "carts_status_check"
        check ("status" in ('active', 'abandoned', 'completed', 'rejected'));
    `);
    this.addSql(`
      alter table "carts"
        add constraint "carts_approval_status_check"
        check ("approval_status" in (
          'not_required', 'pending', 'approved', 'rejected_by_org_admin'
        ));
    `);

    // 4) Foreign keys on the new columns.
    //    sales_channel_id → sales_channels(id). ON DELETE SET NULL keeps the
    //    cart record alive if a channel is deleted (rare; admin operation).
    this.addSql(`
      alter table "carts"
        add constraint "carts_sales_channel_fk"
        foreign key ("sales_channel_id")
        references "sales_channels" ("id")
        on delete set null;
    `);
    //    approved_by_customer_account_id → customer_accounts(id). ON DELETE
    //    SET NULL because the approval record still matters even if the
    //    Org-Admin's Customer account is later deleted.
    this.addSql(`
      alter table "carts"
        add constraint "carts_approved_by_customer_fk"
        foreign key ("approved_by_customer_account_id")
        references "customer_accounts" ("id")
        on delete set null;
    `);
    //    converted_to_quote_request_id → quote_requests(id). ON DELETE
    //    SET NULL because deleting a QR (rare) does not invalidate the
    //    fact that the cart was once converted.
    this.addSql(`
      alter table "carts"
        add constraint "carts_converted_to_qr_fk"
        foreign key ("converted_to_quote_request_id")
        references "quote_requests" ("id")
        on delete set null;
    `);

    // 5) Backfill `sales_channel_id` to the system-default sales channel
    //    so existing rows participate in the new (customer, channel)
    //    uniqueness rule. If no default exists (test fixture), leave
    //    NULL — the read path treats NULL as "system-default channel"
    //    until the next consolidation tightens it (see research.md §R3).
    this.addSql(`
      update "carts"
      set "sales_channel_id" = (
        select "id" from "sales_channels" where "system_default" = true limit 1
      )
      where "sales_channel_id" is null;
    `);

    // 6) Indexes.
    this.addSql(`
      create index "carts_sales_channel_customer_status_idx"
        on "carts" ("sales_channel_id", "customer_account_id", "status");
    `);
    this.addSql(`
      create index "carts_status_last_activity_idx"
        on "carts" ("status", "last_activity_at");
    `);
    this.addSql(`
      create index "carts_applied_promotion_code_idx"
        on "carts" ("applied_promotion_code")
        where "applied_promotion_code" is not null;
    `);
    this.addSql(`
      create index "carts_org_status_updated_idx"
        on "carts" ("organization_id", "status", "updated_at" desc);
    `);

    // 7) Replace the foundation's "one active cart per Customer" partial
    //    unique index with a (Customer, Sales Channel) variant so the spec's
    //    one-active-cart-per-(Customer, Sales Channel) rule is enforced at
    //    the DB layer. Anonymous carts (customer_account_id is null) are
    //    not constrained by this index — anon ownership is enforced by the
    //    existing `anonymous_cart_token` unique index.
    this.addSql(`drop index if exists "carts_one_active_per_customer";`);
    this.addSql(`
      create unique index "carts_one_active_per_customer_per_channel"
        on "carts" ("customer_account_id", "sales_channel_id")
        where "status" = 'active' and "customer_account_id" is not null;
    `);

    // 8) New columns on `cart_items` — two-layer pricing snapshot.
    this.addSql(`
      alter table "cart_items"
        add column "recomputed_unit_price" numeric(12,2) null,
        add column "recomputed_at" timestamptz null,
        add column "recomputed_currency" varchar(3) null;
    `);

    // 9) New column on `organizations` — per-org cart-approval policy.
    this.addSql(`
      alter table "organizations"
        add column "requires_cart_approval" boolean not null default false;
    `);

    // 10) Cart audit feed.
    this.addSql(`
      create table "cart_audit_entries" (
        "id" uuid not null,
        "cart_id" uuid not null,
        "occurred_at" timestamptz not null default now(),
        "actor_type" varchar(32) not null,
        "actor_id" uuid null,
        "action" varchar(64) not null,
        "from_state" varchar(32) null,
        "to_state" varchar(32) null,
        "reason" text null,
        "metadata" jsonb not null default '{}'::jsonb,
        constraint "cart_audit_entries_pkey" primary key ("id"),
        constraint "cart_audit_entries_cart_fk"
          foreign key ("cart_id") references "carts" ("id") on delete cascade,
        constraint "cart_audit_entries_actor_type_check"
          check ("actor_type" in ('customer', 'org_admin', 'platform_admin', 'system', 'sweep'))
      );
    `);
    this.addSql(`
      create index "cart_audit_entries_cart_occurred_idx"
        on "cart_audit_entries" ("cart_id", "occurred_at" desc);
    `);
  }

  override async down(): Promise<void> {
    // Mirror order: drop the cart audit feed first, then the organization
    // column, then cart_items columns, then re-instate the foundation
    // partial unique index, then drop the new carts columns / constraints
    // / indexes.
    this.addSql(`drop index if exists "cart_audit_entries_cart_occurred_idx";`);
    this.addSql(`drop table if exists "cart_audit_entries" cascade;`);

    this.addSql(`alter table "organizations" drop column if exists "requires_cart_approval";`);

    this.addSql(`
      alter table "cart_items"
        drop column if exists "recomputed_unit_price",
        drop column if exists "recomputed_at",
        drop column if exists "recomputed_currency";
    `);

    // Restore foundation's partial unique index.
    this.addSql(`drop index if exists "carts_one_active_per_customer_per_channel";`);
    this.addSql(`
      create unique index "carts_one_active_per_customer"
        on "carts" ("customer_account_id")
        where "status" = 'active' and "customer_account_id" is not null;
    `);

    this.addSql(`drop index if exists "carts_org_status_updated_idx";`);
    this.addSql(`drop index if exists "carts_applied_promotion_code_idx";`);
    this.addSql(`drop index if exists "carts_status_last_activity_idx";`);
    this.addSql(`drop index if exists "carts_sales_channel_customer_status_idx";`);

    this.addSql(`alter table "carts" drop constraint if exists "carts_converted_to_qr_fk";`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_approved_by_customer_fk";`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_sales_channel_fk";`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_approval_status_check";`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_status_check";`);

    this.addSql(`
      alter table "carts"
        drop column if exists "sales_channel_id",
        drop column if exists "last_activity_at",
        drop column if exists "approval_status",
        drop column if exists "submitted_for_approval_at",
        drop column if exists "approved_at",
        drop column if exists "approved_by_customer_account_id",
        drop column if exists "rejected_at",
        drop column if exists "rejected_by_actor",
        drop column if exists "rejected_reason",
        drop column if exists "applied_promotion_code",
        drop column if exists "converted_to_quote_request_id",
        drop column if exists "abandonment_notified_at",
        drop column if exists "version";
    `);

    // Restore legacy 'converted' state for any rows the up() touched.
    // (We cannot perfectly distinguish "converted at the time of migration"
    // from "completed later", so the down() leaves them as 'completed';
    // this is documented as accepted asymmetry.)
  }
}
