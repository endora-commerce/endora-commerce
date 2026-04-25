import { Migration } from '@mikro-orm/migrations';

/**
 * Organization invitations — Phase 5 (T172). Used by US3's invite/accept flow.
 *
 * The (organization_id, email) tuple is unique while consumed_at is null AND
 * revoked_at is null — at most one pending invitation per email per org.
 * This avoids stacking duplicate invitations for the same address.
 */
export class Migration005InvitationsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "organization_invitations" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "invited_by_customer_account_id" uuid null,
        "email" varchar(320) not null,
        "role" varchar(32) not null default 'regular_user',
        "token_hash" varchar(128) not null,
        "expires_at" timestamptz not null,
        "consumed_at" timestamptz null,
        "revoked_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "organization_invitations_pkey" primary key ("id"),
        constraint "organization_invitations_token_hash_unique" unique ("token_hash"),
        constraint "organization_invitations_org_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict
      );
    `);
    this.addSql('create index "organization_invitations_organization_id_index" on "organization_invitations" ("organization_id");');
    this.addSql('create index "organization_invitations_email_index" on "organization_invitations" ("email");');
    this.addSql('create index "organization_invitations_expires_at_index" on "organization_invitations" ("expires_at");');
    this.addSql(
      `create unique index "organization_invitations_one_pending_per_email" on "organization_invitations" ("organization_id", "email") where "consumed_at" is null and "revoked_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "organization_invitations" cascade;');
  }
}
