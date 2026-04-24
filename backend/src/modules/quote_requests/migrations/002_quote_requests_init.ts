import { Migration } from '@mikro-orm/migrations';

/**
 * quote_requests module — Phase 3.5 (T075).
 *
 * Schema notes:
 *   - Foreign keys to customer_accounts / organizations / admin_users stay as
 *     plain uuid columns without FK constraints: those target tables ship in
 *     US2/US3/US4. FKs get added by their respective migrations.
 *   - Partial unique index on (organization_id, customer_account_id) WHERE
 *     status='draft' enforces "one open draft per customer per organization"
 *     (tasks.md T075).
 *   - `version` column drives optimistic concurrency — the `If-Match` header
 *     path uses a CAS `UPDATE ... WHERE version = $expected`.
 */
export class Migration002QuoteRequestsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "quote_requests" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "customer_account_id" uuid not null,
        "status" varchar(32) not null default 'draft',
        "requester_note" text null,
        "assigned_admin_user_id" uuid null,
        "submitted_at" timestamptz null,
        "quoted_at" timestamptz null,
        "responded_at" timestamptz null,
        "expires_at" timestamptz null,
        "quote_terms" jsonb null,
        "version" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "quote_requests_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "quote_requests_organization_id_index" on "quote_requests" ("organization_id");');
    this.addSql('create index "quote_requests_customer_account_id_index" on "quote_requests" ("customer_account_id");');
    this.addSql('create index "quote_requests_status_index" on "quote_requests" ("status");');
    this.addSql(
      `create unique index "quote_requests_one_draft_per_customer" on "quote_requests" ("organization_id", "customer_account_id") where "status" = 'draft';`,
    );

    this.addSql(`
      create table "quote_request_items" (
        "id" uuid not null,
        "quote_request_id" uuid not null,
        "product_id" uuid not null,
        "product_name" varchar(255) not null,
        "variant_id" uuid null,
        "variant_label" varchar(255) null,
        "quantity" int not null,
        "requester_note" text null,
        "quoted_unit_price" numeric(12,2) null,
        "quoted_discount_percent" numeric(5,2) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "quote_request_items_pkey" primary key ("id"),
        constraint "quote_request_items_rfq_fk" foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade
      );
    `);
    this.addSql('create index "quote_request_items_quote_request_id_index" on "quote_request_items" ("quote_request_id");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "quote_request_items" cascade;');
    this.addSql('drop table if exists "quote_requests" cascade;');
  }
}
