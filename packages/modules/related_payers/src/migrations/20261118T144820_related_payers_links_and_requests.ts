import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/182-related-payers/` data-model §1–§2 — the payer link and the payer request.
 *
 * - `related_payer_links`: buyer X (`organization_id`, the tenant anchor) → payer Y. At
 *   most one non-revoked link per ordered pair (partial unique index, FR-010); the scope
 *   names an address exactly when it is `one`. The validity window is two inclusive
 *   instants (`timestamptz`, RP-15) — no store time zone is involved.
 * - `related_payer_requests`: owned by the sender; consumed from Phase 5 on, created here
 *   so the module's schema lands in one migration.
 *
 * No foreign key to `organizations` or `addresses`: a hard-deleted address must not block
 * anything, and usability is re-checked at read (FR-012).
 */
export class Migration20261118T144820RelatedPayersLinksAndRequests extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "related_payer_links" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "payer_organization_id" uuid not null,
        "state" varchar(16) not null default 'active',
        "address_scope" varchar(8) not null default 'all',
        "billing_address_id" uuid null,
        "valid_from" timestamptz null,
        "valid_to" timestamptz null,
        "commercial_terms" varchar(8) not null default 'buyer',
        "notify_payer_on_orders" boolean not null default false,
        "origin" varchar(16) not null,
        "origin_source" varchar(64) null,
        "origin_request_id" uuid null,
        "revoked_at" timestamptz null,
        "revoked_by_kind" varchar(16) null,
        "revoked_by_id" uuid null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "related_payer_links_pkey" primary key ("id"),
        constraint "related_payer_links_distinct_pair" check ("organization_id" <> "payer_organization_id"),
        constraint "related_payer_links_state_check" check ("state" in ('active', 'inactive', 'revoked')),
        constraint "related_payer_links_scope_check" check (
          ("address_scope" = 'all' and "billing_address_id" is null)
          or ("address_scope" = 'one' and "billing_address_id" is not null)
        ),
        constraint "related_payer_links_terms_check" check ("commercial_terms" in ('buyer', 'payer')),
        constraint "related_payer_links_origin_check" check ("origin" in ('operator', 'automation', 'request', 'invitation')),
        constraint "related_payer_links_window_check" check (
          "valid_from" is null or "valid_to" is null or "valid_from" <= "valid_to"
        )
      );
    `);
    this.addSql(`create index "related_payer_links_organization_id_index" on "related_payer_links" ("organization_id");`);
    this.addSql(
      `create index "related_payer_links_payer_organization_id_index" on "related_payer_links" ("payer_organization_id");`,
    );
    this.addSql(
      `create unique index "related_payer_links_one_live_per_pair" on "related_payer_links" ("organization_id", "payer_organization_id") where "state" <> 'revoked';`,
    );

    this.addSql(`
      create table "related_payer_requests" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "direction" varchar(24) not null,
        "sender_customer_account_id" uuid not null,
        "tax_id_normalized" varchar(32) not null,
        "contact_email" varchar(320) not null,
        "comment" text null,
        "counterparty_organization_id" uuid null,
        "routing" varchar(24) not null,
        "operator_reason" varchar(32) null,
        "approval_mode" varchar(24) not null,
        "unregistered_mode" varchar(8) not null,
        "state" varchar(16) not null default 'pending',
        "counterparty_accepted_at" timestamptz null,
        "decided_at" timestamptz null,
        "decided_by_kind" varchar(16) null,
        "decided_by_id" uuid null,
        "rejection_reason" text null,
        "link_id" uuid null,
        "sales_channel_id" uuid not null,
        "language" varchar(8) not null,
        "invitation_token_hash" varchar(128) null,
        "expires_at" timestamptz not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "related_payer_requests_pkey" primary key ("id"),
        constraint "related_payer_requests_direction_check" check ("direction" in ('buyer_request', 'payer_invitation')),
        constraint "related_payer_requests_state_check" check (
          "state" in ('pending', 'active', 'rejected', 'expired', 'withdrawn')
        ),
        constraint "related_payer_requests_routing_check" check (
          "routing" in ('counterparty', 'operator', 'awaiting_registration')
        )
      );
    `);
    this.addSql(
      `create index "related_payer_requests_organization_created_index" on "related_payer_requests" ("organization_id", "created_at");`,
    );
    this.addSql(
      `create index "related_payer_requests_state_expires_index" on "related_payer_requests" ("state", "expires_at");`,
    );
    this.addSql(
      `create index "related_payer_requests_counterparty_state_index" on "related_payer_requests" ("counterparty_organization_id", "state");`,
    );
    this.addSql(
      `create index "related_payer_requests_tax_routing_state_index" on "related_payer_requests" ("tax_id_normalized", "routing", "state");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "related_payer_requests";`);
    this.addSql(`drop table if exists "related_payer_links";`);
  }
}
