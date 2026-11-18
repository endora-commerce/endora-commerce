import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/181-guest-complaints/` (data-model §1 – §4, §7): the complaint from a guest
 * without a customer account.
 *
 * 1. `return_cases` — `customer_account_id` becomes nullable (`null` = a guest case,
 *    research R-2), with the guest session that filed it, when its contact address was
 *    verified and the tracking link's version. Three checks hold the guest's shape: a
 *    guest case never carries an organization (research R-1), always has a session and a
 *    version, and is a complaint with no platform order (G1, FR-034); a customer case
 *    carries neither guest column. A guest's submission key is unique per session
 *    (R-4). Two indexes serve the retention sweep and the admin's search by contact
 *    e-mail (R-9, R-10).
 * 2. `return_case_comments` — `author_guest`: a comment posted through the tracking link,
 *    always customer-visible and with no author id.
 * 3. `return_case_attachments` — the guest session that uploaded a file, and whether a
 *    guest did; a pending upload always has an owner.
 * 4. `return_guest_verifications` — new: one row per verification link requested, which
 *    becomes the guest session once redeemed (R-3, R-4). Only hashes of the session
 *    token are stored.
 *
 * Every existing row has an account (the column was `not null`), so every check is
 * validated when created. It references no other module's table. `down` refuses while a
 * guest case exists: `customer_account_id` cannot become `not null` again without
 * deleting it.
 *
 * This stamp orders this migration against its own module's migrations and against
 * nothing else; it follows `returns_off_platform_complaints`.
 */
export class Migration20261116T104415ReturnsGuestComplaints extends Migration {
  override async up(): Promise<void> {
    // 1. Cases.
    this.addSql('alter table "return_cases" alter column "customer_account_id" drop not null;');
    this.addSql(
      'alter table "return_cases" ' +
        'add column if not exists "guest_session_id" uuid null, ' +
        'add column if not exists "contact_verified_at" timestamptz null, ' +
        'add column if not exists "tracking_version" integer null;',
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_guest_no_org_check";');
    this.addSql(
      'alter table "return_cases" add constraint "return_cases_guest_no_org_check" check ("customer_account_id" is not null or "organization_id" is null);',
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_guest_shape_check";');
    this.addSql(
      'alter table "return_cases" add constraint "return_cases_guest_shape_check" check (' +
        '"customer_account_id" is not null or (' +
        `"guest_session_id" is not null and "tracking_version" is not null and "order_id" is null and "kind" = 'complaint'));`,
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_customer_shape_check";');
    this.addSql(
      'alter table "return_cases" add constraint "return_cases_customer_shape_check" check (' +
        '"customer_account_id" is null or ("guest_session_id" is null and "tracking_version" is null));',
    );
    this.addSql(
      'create unique index if not exists "return_cases_guest_submission_key_unique" on "return_cases" ("guest_session_id", "submission_key") ' +
        'where "customer_account_id" is null and "submission_key" is not null;',
    );
    this.addSql(
      'create index if not exists "return_cases_guest_retention_idx" on "return_cases" ("closed_at") ' +
        'where "customer_account_id" is null and "personal_data_erased_at" is null;',
    );
    this.addSql(
      `create index if not exists "return_cases_contact_email_idx" on "return_cases" (lower("contact"->>'email')) where "contact" is not null;`,
    );

    // 2. Comments.
    this.addSql('alter table "return_case_comments" add column if not exists "author_guest" boolean not null default false;');
    this.addSql('alter table "return_case_comments" drop constraint if exists "return_case_comments_guest_author_check";');
    this.addSql(
      'alter table "return_case_comments" add constraint "return_case_comments_guest_author_check" check (' +
        '"author_guest" = false or ("author_admin_user_id" is null and "author_customer_account_id" is null and "is_customer_visible" = true));',
    );

    // 3. Attachments.
    this.addSql(
      'alter table "return_case_attachments" ' +
        'add column if not exists "guest_session_id" uuid null, ' +
        'add column if not exists "uploaded_by_guest" boolean not null default false;',
    );
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_owner_check";');
    this.addSql(
      'alter table "return_case_attachments" add constraint "return_case_attachments_owner_check" check (' +
        '"return_case_id" is not null or "customer_account_id" is not null or "guest_session_id" is not null);',
    );
    this.addSql(
      'create index if not exists "return_case_attachments_guest_pending_idx" on "return_case_attachments" ("guest_session_id") where "return_case_id" is null;',
    );

    // 4. Verifications and guest sessions.
    this.addSql(`
      create table if not exists "return_guest_verifications" (
        "id" uuid not null,
        "sales_channel_id" uuid not null,
        "email" varchar(254) not null,
        "email_hash" char(64) not null,
        "language" varchar(16) not null,
        "link_expires_at" timestamptz not null,
        "redeemed_at" timestamptz null,
        "session_token_hash" char(64) null,
        "session_expires_at" timestamptz null,
        "ended_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        constraint "return_guest_verifications_pkey" primary key ("id"),
        constraint "return_guest_verifications_session_check" check (("redeemed_at" is null) = ("session_token_hash" is null))
      );
    `);
    this.addSql(
      'create unique index if not exists "return_guest_verifications_session_token_hash_unique" on "return_guest_verifications" ("session_token_hash") ' +
        'where "session_token_hash" is not null;',
    );
    this.addSql(
      'create index if not exists "return_guest_verifications_email_channel_idx" on "return_guest_verifications" ("email_hash", "sales_channel_id", "created_at");',
    );
    this.addSql(
      'create index if not exists "return_guest_verifications_created_at_idx" on "return_guest_verifications" ("created_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if exists (select 1 from "return_cases" where "customer_account_id" is null) then
          raise exception 'returns: guest cases exist; the migration cannot be reversed without deleting them';
        end if;
      end $$;
    `);
    this.addSql('drop table if exists "return_guest_verifications";');

    // Pending guest uploads have no owner the old shape can hold.
    this.addSql('delete from "return_case_attachments" where "return_case_id" is null and "customer_account_id" is null;');
    this.addSql('drop index if exists "return_case_attachments_guest_pending_idx";');
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_owner_check";');
    this.addSql(
      'alter table "return_case_attachments" drop column if exists "guest_session_id", drop column if exists "uploaded_by_guest";',
    );

    this.addSql('alter table "return_case_comments" drop constraint if exists "return_case_comments_guest_author_check";');
    this.addSql('alter table "return_case_comments" drop column if exists "author_guest";');

    this.addSql('drop index if exists "return_cases_contact_email_idx";');
    this.addSql('drop index if exists "return_cases_guest_retention_idx";');
    this.addSql('drop index if exists "return_cases_guest_submission_key_unique";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_customer_shape_check";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_guest_shape_check";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_guest_no_org_check";');
    this.addSql(
      'alter table "return_cases" ' +
        'drop column if exists "guest_session_id", ' +
        'drop column if exists "contact_verified_at", ' +
        'drop column if exists "tracking_version", ' +
        'alter column "customer_account_id" set not null;',
    );
  }
}
