import { Migration } from '@mikro-orm/migrations';

/**
 * `forms` — the whole schema of the module, in one migration
 * (`specs/170-forms-module/data-model.md` §§1–5).
 *
 * Four tables: a form and its working copy, its immutable published versions, the entries
 * shoppers submit against a version, and the notes employees add to an entry. Everything lands
 * here, before the first user story, so no later story adds a migration.
 *
 * **No foreign key leaves the module.** The sales channel, the customer account, the organisation
 * and the administrators are held by value, so the manifest declares no dependency for this
 * migration's sake. Inside the module the keys cascade: a form takes its versions, entries and
 * notes with it, an entry its notes. The form's pointer at its published version is the one
 * circular key; it is added after both tables exist and lets the version go first.
 *
 * `form_entries_attribution_chk` is an **equivalence** — account and organisation are null together
 * or set together (research § Principle XI review): MikroORM applies no filter to an INSERT, so this
 * is the write's only refusal of a half-attributed entry.
 *
 * Search is a substring match over the submitter e-mail and the text answers, backed by trigram
 * indexes; `pg_trgm` is created if absent, as other modules' migrations do.
 */
export class Migration20261102T111501FormsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create extension if not exists pg_trgm;`);

    this.addSql(`
      create table "forms" (
        "id" uuid not null default gen_random_uuid(),
        "key" varchar(64) not null,
        "name" varchar(200) not null,
        "default_language" varchar(16) not null,
        "status" varchar(16) not null default 'draft',
        "definition" jsonb not null,
        "revision" integer not null default 1,
        "published_version_id" uuid null,
        "published_version_number" integer not null default 0,
        "recipients" jsonb not null default '[]',
        "channel_recipients" jsonb not null default '{}',
        "retention_days" integer null,
        "accepted_entry_count" integer not null default 0,
        "created_by_admin_user_id" uuid null,
        "updated_by_admin_user_id" uuid null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "forms_pkey" primary key ("id"),
        constraint "forms_key_unique" unique ("key"),
        constraint "forms_status_chk" check ("status" in ('draft', 'published', 'closed')),
        constraint "forms_retention_days_chk" check ("retention_days" is null or "retention_days" between 1 and 3650),
        constraint "forms_accepted_entry_count_chk" check ("accepted_entry_count" >= 0)
      );
    `);
    this.addSql(`create index "forms_status_idx" on "forms" ("status");`);
    // The retention pass walks only the forms that keep entries for a limited time.
    this.addSql(`create index "forms_retention_idx" on "forms" ("retention_days") where "retention_days" is not null;`);

    this.addSql(`
      create table "form_versions" (
        "id" uuid not null default gen_random_uuid(),
        "form_id" uuid not null,
        "number" integer not null,
        "definition" jsonb not null,
        "default_language" varchar(16) not null,
        "published_at" timestamptz not null default now(),
        "published_by_admin_user_id" uuid null,
        constraint "form_versions_pkey" primary key ("id"),
        constraint "form_versions_form_id_number_unique" unique ("form_id", "number"),
        constraint "form_versions_number_chk" check ("number" >= 1),
        constraint "form_versions_form_id_foreign" foreign key ("form_id") references "forms" ("id") on delete cascade
      );
    `);

    this.addSql(`
      create table "form_entries" (
        "id" uuid not null default gen_random_uuid(),
        "form_id" uuid not null,
        "form_version_id" uuid not null,
        "form_version_number" integer not null,
        "sales_channel_id" uuid not null,
        "language" varchar(16) not null,
        "page_url" varchar(2048) null,
        "submitted_at" timestamptz not null default now(),
        "answers" jsonb not null default '{}',
        "consents" jsonb not null default '[]',
        "submitter_email" varchar(320) null,
        "search_text" text not null default '',
        "status" varchar(16) not null default 'new',
        "confirmation_sent_at" timestamptz null,
        "customer_account_id" uuid null,
        "organization_id" uuid null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "form_entries_pkey" primary key ("id"),
        constraint "form_entries_attribution_chk" check (("customer_account_id" is null) = ("organization_id" is null)),
        constraint "form_entries_status_chk" check ("status" in ('new', 'read', 'closed', 'spam')),
        constraint "form_entries_search_text_chk" check (char_length("search_text") <= 20000),
        constraint "form_entries_form_id_foreign" foreign key ("form_id") references "forms" ("id") on delete cascade,
        constraint "form_entries_form_version_id_foreign" foreign key ("form_version_id") references "form_versions" ("id") on delete cascade
      );
    `);
    // The list and its keyset, with and without a form filter (R-18).
    this.addSql(
      `create index "form_entries_form_submitted_idx" on "form_entries" ("form_id", "submitted_at" desc, "id" desc);`,
    );
    this.addSql(`create index "form_entries_submitted_idx" on "form_entries" ("submitted_at" desc, "id" desc);`);
    this.addSql(`create index "form_entries_status_idx" on "form_entries" ("status");`);
    this.addSql(`create index "form_entries_channel_idx" on "form_entries" ("sales_channel_id");`);
    // The guard's `allowed-set` predicate and the account erasure (R-17).
    this.addSql(`create index "form_entries_organization_idx" on "form_entries" ("organization_id");`);
    this.addSql(`create index "form_entries_customer_account_id_index" on "form_entries" ("customer_account_id");`);
    this.addSql(
      `create index "form_entries_email_trgm_idx" on "form_entries" using gin ("submitter_email" gin_trgm_ops);`,
    );
    this.addSql(`create index "form_entries_search_trgm_idx" on "form_entries" using gin ("search_text" gin_trgm_ops);`);

    this.addSql(`
      create table "form_entry_notes" (
        "id" uuid not null default gen_random_uuid(),
        "entry_id" uuid not null,
        "body" text not null,
        "author_admin_user_id" uuid null,
        "created_at" timestamptz not null default now(),
        constraint "form_entry_notes_pkey" primary key ("id"),
        constraint "form_entry_notes_body_chk" check (char_length("body") between 1 and 5000),
        constraint "form_entry_notes_entry_id_foreign" foreign key ("entry_id") references "form_entries" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "form_entry_notes_entry_id_index" on "form_entry_notes" ("entry_id");`);

    // The circular key, once both tables exist.
    this.addSql(`
      alter table "forms"
        add constraint "forms_published_version_id_foreign"
        foreign key ("published_version_id") references "form_versions" ("id")
        on delete set null deferrable initially immediate;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "forms" drop constraint if exists "forms_published_version_id_foreign";`);
    this.addSql(`drop table if exists "form_entry_notes";`);
    this.addSql(`drop table if exists "form_entries";`);
    this.addSql(`drop table if exists "form_versions";`);
    this.addSql(`drop table if exists "forms";`);
  }
}
