import { Migration } from '@mikro-orm/migrations';

/**
 * MFA module init (feature 042).
 *
 * Creates the four MFA-owned tables:
 *   - mfa_enrolments            — per-account TOTP enrolment (encrypted secret)
 *   - mfa_recovery_codes        — single-use backup codes (hashed)
 *   - mfa_social_identities     — Google/Microsoft account links
 *   - mfa_organization_policies — per-organization enforcement flag
 *
 * The legacy scaffolding columns (`customer_accounts.two_factor_secret`,
 * `admin_users.two_factor_secret`, …) are SUPERSEDED by `mfa_enrolments` and
 * left dormant (research §R8). No encrypted backfill is performed in SQL: the
 * secret cipher runs in application code, and the legacy columns hold no
 * live, confirmed enrolments (the earlier 2FA path was never wired). Any
 * pre-existing user simply re-enrols from the security screen.
 */
export class Migration067MfaInit extends Migration {
  override async up(): Promise<void> {
    // --- mfa_enrolments -----------------------------------------------------
    this.addSql(`
      create table "mfa_enrolments" (
        "id" uuid not null,
        "subject_type" varchar(16) not null,
        "subject_id" uuid not null,
        "status" varchar(16) not null default 'pending',
        "secret_ciphertext" bytea not null,
        "secret_iv" bytea not null,
        "secret_auth_tag" bytea not null,
        "last_accepted_step" bigint null,
        "confirmed_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "mfa_enrolments_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "mfa_enrolments_subject_type_index" on "mfa_enrolments" ("subject_type");`,
    );
    this.addSql(
      `create index "mfa_enrolments_subject_id_index" on "mfa_enrolments" ("subject_id");`,
    );
    // At most one active enrolment per subject.
    this.addSql(
      `create unique index "mfa_enrolments_active_subject_unique" on "mfa_enrolments" ("subject_type", "subject_id") where "status" = 'active';`,
    );

    // --- mfa_recovery_codes -------------------------------------------------
    this.addSql(`
      create table "mfa_recovery_codes" (
        "id" uuid not null,
        "enrolment_id" uuid not null,
        "code_hash" varchar(128) not null,
        "used_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "mfa_recovery_codes_pkey" primary key ("id"),
        constraint "mfa_recovery_codes_enrolment_fk" foreign key ("enrolment_id")
          references "mfa_enrolments" ("id") on delete cascade
      );
    `);
    this.addSql(
      `create index "mfa_recovery_codes_enrolment_id_index" on "mfa_recovery_codes" ("enrolment_id");`,
    );
    this.addSql(
      `create unique index "mfa_recovery_codes_enrolment_hash_unique" on "mfa_recovery_codes" ("enrolment_id", "code_hash");`,
    );

    // --- mfa_social_identities ----------------------------------------------
    this.addSql(`
      create table "mfa_social_identities" (
        "id" uuid not null,
        "subject_type" varchar(16) not null,
        "subject_id" uuid not null,
        "provider" varchar(16) not null,
        "provider_subject" varchar(255) not null,
        "email" varchar(320) not null,
        "linked_at" timestamptz not null,
        "last_used_at" timestamptz null,
        constraint "mfa_social_identities_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create unique index "mfa_social_identities_provider_subject_unique" on "mfa_social_identities" ("provider", "provider_subject");`,
    );
    this.addSql(
      `create unique index "mfa_social_identities_subject_provider_unique" on "mfa_social_identities" ("subject_type", "subject_id", "provider");`,
    );
    this.addSql(
      `create index "mfa_social_identities_provider_email_index" on "mfa_social_identities" ("provider", "email");`,
    );

    // --- mfa_organization_policies ------------------------------------------
    this.addSql(`
      create table "mfa_organization_policies" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "enforce_totp" boolean not null default false,
        "updated_by_actor" varchar(64) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "mfa_organization_policies_pkey" primary key ("id"),
        constraint "mfa_organization_policies_org_unique" unique ("organization_id")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "mfa_organization_policies";`);
    this.addSql(`drop table if exists "mfa_social_identities";`);
    this.addSql(`drop table if exists "mfa_recovery_codes";`);
    this.addSql(`drop table if exists "mfa_enrolments";`);
  }
}
