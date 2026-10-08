import { Migration } from '@mikro-orm/migrations';

/**
 * `crm` — the whole schema of the module, in one migration
 * (`specs/143-crm-sales-opportunities/data-model.md`).
 *
 * Thirteen tables and one sequence. Everything lands here, before the first
 * user story, so that no later story adds a migration or an entity: the
 * generated registries are rewritten by every such addition, and stories built
 * in parallel would collide on them.
 *
 * Two foreign keys leave the module, both `on delete restrict`:
 * `crm_opportunities.organization_id` → `organizations` and
 * `crm_opportunities.sales_channel_id` → `sales_channels`. The manifest
 * declares both owners. Every other cross-module reference — an Order, a Quote
 * Request, a customer account, an admin user, an asset, a Product — is held by
 * value and validated through its owner's port, because the owner may be
 * switched off, or the column is polymorphic.
 *
 * Status codes are referenced **by value** inside the module too
 * (`status_code`, the transition and mapping tables), as `order_statuses` are:
 * the service validates them against the configured workflow on every write.
 *
 * The default workflow is seeded here, into this module's own tables: six
 * statuses and the transitions between them, including `lost → new` — a closed
 * Opportunity may be reopened. No status mapping and no value-counting status
 * is seeded; those name Order statuses, which are the operator's.
 */
export class Migration20261005T132439CrmInit extends Migration {
  override async up(): Promise<void> {
    // --- Workflow configuration -------------------------------------------
    this.addSql(`
      create table "crm_opportunity_statuses" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null default '{}',
        "default_name" varchar(120) not null,
        "kind" varchar(8) not null,
        "is_initial" boolean not null default false,
        "weight" int not null default 100,
        "color" varchar(16) not null default '#64748b',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_opportunity_statuses_pkey" primary key ("id"),
        constraint "crm_opportunity_statuses_code_unique" unique ("code"),
        constraint "crm_opportunity_statuses_kind_check" check ("kind" in ('open', 'won', 'lost'))
      );
    `);
    // At most one initial status. The service additionally requires exactly one.
    this.addSql(
      `create unique index "crm_opportunity_statuses_one_initial" on "crm_opportunity_statuses" ("is_initial") where "is_initial";`,
    );

    this.addSql(`
      create table "crm_opportunity_status_transitions" (
        "id" uuid not null,
        "from_status_code" varchar(64) not null,
        "to_status_code" varchar(64) not null,
        "created_at" timestamptz not null,
        constraint "crm_opportunity_status_transitions_pkey" primary key ("id"),
        constraint "crm_opportunity_status_transitions_from_to_unique" unique ("from_status_code", "to_status_code"),
        constraint "crm_opportunity_status_transitions_distinct_check" check ("from_status_code" <> "to_status_code")
      );
    `);
    this.addSql(
      `create index "crm_opportunity_status_transitions_from_status_code_index" on "crm_opportunity_status_transitions" ("from_status_code");`,
    );

    this.addSql(`
      create table "crm_order_status_mappings" (
        "id" uuid not null,
        "direction" varchar(24) not null,
        "opportunity_status_code" varchar(64) not null,
        "order_status_code" varchar(64) not null,
        "require_all_orders" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_order_status_mappings_pkey" primary key ("id"),
        constraint "crm_order_status_mappings_direction_check"
          check ("direction" in ('opportunity_to_order', 'order_to_opportunity'))
      );
    `);
    // One Order status per Opportunity status, and one Opportunity status per
    // Order status — each within its own direction.
    this.addSql(
      `create unique index "crm_order_status_mappings_forward_unique" on "crm_order_status_mappings" ("opportunity_status_code") where "direction" = 'opportunity_to_order';`,
    );
    this.addSql(
      `create unique index "crm_order_status_mappings_reverse_unique" on "crm_order_status_mappings" ("order_status_code") where "direction" = 'order_to_opportunity';`,
    );

    this.addSql(`
      create table "crm_value_counting_statuses" (
        "id" uuid not null,
        "document_kind" varchar(16) not null,
        "status_code" varchar(64) not null,
        "created_at" timestamptz not null,
        constraint "crm_value_counting_statuses_pkey" primary key ("id"),
        constraint "crm_value_counting_statuses_kind_status_unique" unique ("document_kind", "status_code"),
        constraint "crm_value_counting_statuses_document_kind_check"
          check ("document_kind" in ('order', 'quote_request'))
      );
    `);

    this.addSql(`
      create table "crm_tags" (
        "id" uuid not null,
        "name" varchar(64) not null,
        "color" varchar(16) not null default '#64748b',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_tags_pkey" primary key ("id")
      );
    `);
    this.addSql(`create unique index "crm_tags_name_lower_unique" on "crm_tags" (lower("name"));`);

    // --- Opportunities ----------------------------------------------------
    this.addSql(`create sequence "crm_opportunity_number_seq" start with 1 increment by 1;`);

    this.addSql(`
      create table "crm_opportunities" (
        "id" uuid not null,
        "number" varchar(32) not null,
        "title" varchar(200) not null,
        "description" text null,
        "organization_id" uuid not null,
        "customer_account_id" uuid null,
        "sales_channel_id" uuid null,
        "status_code" varchar(64) not null,
        "assigned_admin_user_id" uuid null,
        "value_mode" varchar(8) not null default 'manual',
        "manual_value" numeric(14,2) null,
        "computed_value" numeric(14,2) not null default 0,
        "currency" char(3) not null,
        "expected_close_date" date null,
        "source" varchar(16) not null default 'manual',
        "closed_at" timestamptz null,
        "closed_kind" varchar(8) null,
        "created_by_admin_user_id" uuid null,
        "version" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_opportunities_pkey" primary key ("id"),
        constraint "crm_opportunities_number_unique" unique ("number"),
        constraint "crm_opportunities_organization_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict,
        constraint "crm_opportunities_sales_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete restrict,
        constraint "crm_opportunities_value_mode_check" check ("value_mode" in ('manual', 'computed')),
        constraint "crm_opportunities_source_check" check ("source" in ('manual', 'order', 'quote_request')),
        constraint "crm_opportunities_closed_kind_check"
          check ("closed_kind" is null or "closed_kind" in ('won', 'lost'))
      );
    `);
    this.addSql(`create index "crm_opportunities_organization_id_index" on "crm_opportunities" ("organization_id");`);
    this.addSql(`create index "crm_opportunities_sales_channel_id_index" on "crm_opportunities" ("sales_channel_id");`);
    this.addSql(`create index "crm_opportunities_status_code_index" on "crm_opportunities" ("status_code");`);
    this.addSql(
      `create index "crm_opportunities_assigned_admin_user_id_index" on "crm_opportunities" ("assigned_admin_user_id");`,
    );
    this.addSql(`create index "crm_opportunities_closed_at_index" on "crm_opportunities" ("closed_at");`);
    this.addSql(`create index "crm_opportunities_created_at_index" on "crm_opportunities" ("created_at");`);
    this.addSql(
      `create index "crm_opportunities_organization_status_index" on "crm_opportunities" ("organization_id", "status_code");`,
    );
    this.addSql(
      `create index "crm_opportunities_assignee_status_index" on "crm_opportunities" ("assigned_admin_user_id", "status_code");`,
    );
    this.addSql(
      `create index "crm_opportunities_closed_kind_closed_at_index" on "crm_opportunities" ("closed_kind", "closed_at");`,
    );

    // --- Children of an opportunity ---------------------------------------
    this.addSql(`
      create table "crm_opportunity_links" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "document_kind" varchar(16) not null,
        "document_id" uuid not null,
        "sync_status" boolean not null default true,
        "link_source" varchar(24) not null,
        "linked_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        constraint "crm_opportunity_links_pkey" primary key ("id"),
        constraint "crm_opportunity_links_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_links_document_kind_check"
          check ("document_kind" in ('order', 'quote_request')),
        constraint "crm_opportunity_links_link_source_check"
          check ("link_source" in ('manual', 'auto', 'created_from_opportunity', 'quote_conversion'))
      );
    `);
    this.addSql(`create index "crm_opportunity_links_opportunity_id_index" on "crm_opportunity_links" ("opportunity_id");`);
    // A document belongs to at most one Opportunity; this is also what makes
    // automatic creation idempotent under event redelivery.
    this.addSql(
      `create unique index "crm_opportunity_links_document_unique" on "crm_opportunity_links" ("document_kind", "document_id");`,
    );

    this.addSql(`
      create table "crm_opportunity_status_history" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "from_status_code" varchar(64) null,
        "to_status_code" varchar(64) not null,
        "changed_at" timestamptz not null,
        "actor_admin_user_id" uuid null,
        "cause" varchar(16) not null,
        "cause_order_id" uuid null,
        "reason" text null,
        constraint "crm_opportunity_status_history_pkey" primary key ("id"),
        constraint "crm_opportunity_status_history_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_status_history_cause_check"
          check ("cause" in ('manual', 'order_status', 'system', 'created'))
      );
    `);
    this.addSql(
      `create index "crm_opportunity_status_history_opportunity_changed_at_index" on "crm_opportunity_status_history" ("opportunity_id", "changed_at");`,
    );
    this.addSql(
      `create index "crm_opportunity_status_history_to_status_code_index" on "crm_opportunity_status_history" ("to_status_code");`,
    );
    this.addSql(
      `create index "crm_opportunity_status_history_changed_at_index" on "crm_opportunity_status_history" ("changed_at");`,
    );

    this.addSql(`
      create table "crm_status_propagations" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "order_id" uuid not null,
        "direction" varchar(24) not null,
        "opportunity_status_code" varchar(64) not null,
        "order_status_code" varchar(64) not null,
        "outcome" varchar(16) not null,
        "detail" text null,
        "echoed" boolean not null default false,
        "dismissed_at" timestamptz null,
        "status_history_id" uuid null,
        "created_at" timestamptz not null,
        "resolved_at" timestamptz null,
        constraint "crm_status_propagations_pkey" primary key ("id"),
        constraint "crm_status_propagations_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_status_propagations_direction_check"
          check ("direction" in ('opportunity_to_order', 'order_to_opportunity')),
        constraint "crm_status_propagations_outcome_check"
          check ("outcome" in ('pending', 'applied', 'already_there', 'not_found', 'unknown_status',
                               'not_permitted', 'vetoed', 'skipped', 'failed'))
      );
    `);
    this.addSql(
      `create index "crm_status_propagations_opportunity_created_at_index" on "crm_status_propagations" ("opportunity_id", "created_at");`,
    );
    this.addSql(
      `create index "crm_status_propagations_order_direction_outcome_index" on "crm_status_propagations" ("order_id", "direction", "outcome");`,
    );

    this.addSql(`
      create table "crm_opportunity_tags" (
        "opportunity_id" uuid not null,
        "tag_id" uuid not null,
        "created_at" timestamptz not null,
        constraint "crm_opportunity_tags_pkey" primary key ("opportunity_id", "tag_id"),
        constraint "crm_opportunity_tags_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_tags_tag_fk" foreign key ("tag_id")
          references "crm_tags" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "crm_opportunity_tags_tag_id_index" on "crm_opportunity_tags" ("tag_id");`);

    this.addSql(`
      create table "crm_opportunity_comments" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "kind" varchar(8) not null,
        "author_admin_user_id" uuid not null,
        "body" text not null,
        "edited_at" timestamptz null,
        "deleted_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "crm_opportunity_comments_pkey" primary key ("id"),
        constraint "crm_opportunity_comments_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_comments_kind_check" check ("kind" in ('note', 'message'))
      );
    `);
    this.addSql(
      `create index "crm_opportunity_comments_opportunity_kind_created_at_index" on "crm_opportunity_comments" ("opportunity_id", "kind", "created_at");`,
    );

    this.addSql(`
      create table "crm_opportunity_attachments" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "asset_id" uuid not null,
        "file_name" varchar(255) not null,
        "uploaded_by_admin_user_id" uuid not null,
        "created_at" timestamptz not null,
        constraint "crm_opportunity_attachments_pkey" primary key ("id"),
        constraint "crm_opportunity_attachments_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_attachments_opportunity_asset_unique" unique ("opportunity_id", "asset_id")
      );
    `);
    this.addSql(
      `create index "crm_opportunity_attachments_opportunity_id_index" on "crm_opportunity_attachments" ("opportunity_id");`,
    );
    this.addSql(
      `create index "crm_opportunity_attachments_asset_id_index" on "crm_opportunity_attachments" ("asset_id");`,
    );

    this.addSql(`
      create table "crm_opportunity_references" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "source_kind" varchar(16) not null,
        "source_id" uuid null,
        "target_type" varchar(16) not null,
        "target_id" uuid not null,
        constraint "crm_opportunity_references_pkey" primary key ("id"),
        constraint "crm_opportunity_references_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_references_source_kind_check"
          check ("source_kind" in ('description', 'comment')),
        constraint "crm_opportunity_references_target_type_check"
          check ("target_type" in ('product', 'order'))
      );
    `);
    this.addSql(
      `create index "crm_opportunity_references_opportunity_id_index" on "crm_opportunity_references" ("opportunity_id");`,
    );
    this.addSql(
      `create index "crm_opportunity_references_target_index" on "crm_opportunity_references" ("target_type", "target_id");`,
    );

    // --- The default workflow (this module's own rows) --------------------
    this.addSql(`
      insert into "crm_opportunity_statuses"
        ("id", "code", "name", "default_name", "kind", "is_initial", "weight", "color", "created_at", "updated_at")
      values
        (gen_random_uuid(), 'new',         '{"en": "New", "pl": "Nowa"}',                  'New',         'open', true,  10,  '#64748b', now(), now()),
        (gen_random_uuid(), 'qualified',   '{"en": "Qualified", "pl": "Zakwalifikowana"}', 'Qualified',   'open', false, 20,  '#3b82f6', now(), now()),
        (gen_random_uuid(), 'proposal',    '{"en": "Proposal", "pl": "Oferta"}',           'Proposal',    'open', false, 30,  '#8b5cf6', now(), now()),
        (gen_random_uuid(), 'negotiation', '{"en": "Negotiation", "pl": "Negocjacje"}',    'Negotiation', 'open', false, 40,  '#f59e0b', now(), now()),
        (gen_random_uuid(), 'won',         '{"en": "Won", "pl": "Wygrana"}',               'Won',         'won',  false, 90,  '#10b981', now(), now()),
        (gen_random_uuid(), 'lost',        '{"en": "Lost", "pl": "Przegrana"}',            'Lost',        'lost', false, 100, '#ef4444', now(), now());
    `);
    this.addSql(`
      insert into "crm_opportunity_status_transitions" ("id", "from_status_code", "to_status_code", "created_at")
      values
        (gen_random_uuid(), 'new',         'qualified',   now()),
        (gen_random_uuid(), 'qualified',   'proposal',    now()),
        (gen_random_uuid(), 'proposal',    'negotiation', now()),
        (gen_random_uuid(), 'negotiation', 'won',         now()),
        (gen_random_uuid(), 'proposal',    'won',         now()),
        (gen_random_uuid(), 'new',         'lost',        now()),
        (gen_random_uuid(), 'qualified',   'lost',        now()),
        (gen_random_uuid(), 'proposal',    'lost',        now()),
        (gen_random_uuid(), 'negotiation', 'lost',        now()),
        (gen_random_uuid(), 'lost',        'new',         now());
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "crm_opportunity_references" cascade;');
    this.addSql('drop table if exists "crm_opportunity_attachments" cascade;');
    this.addSql('drop table if exists "crm_opportunity_comments" cascade;');
    this.addSql('drop table if exists "crm_opportunity_tags" cascade;');
    this.addSql('drop table if exists "crm_status_propagations" cascade;');
    this.addSql('drop table if exists "crm_opportunity_status_history" cascade;');
    this.addSql('drop table if exists "crm_opportunity_links" cascade;');
    this.addSql('drop table if exists "crm_opportunities" cascade;');
    this.addSql('drop sequence if exists "crm_opportunity_number_seq";');
    this.addSql('drop table if exists "crm_tags" cascade;');
    this.addSql('drop table if exists "crm_value_counting_statuses" cascade;');
    this.addSql('drop table if exists "crm_order_status_mappings" cascade;');
    this.addSql('drop table if exists "crm_opportunity_status_transitions" cascade;');
    this.addSql('drop table if exists "crm_opportunity_statuses" cascade;');
  }
}
