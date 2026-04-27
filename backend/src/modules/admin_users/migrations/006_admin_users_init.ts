import { Migration } from '@mikro-orm/migrations';

/**
 * Admin module — Phase 6 (T184). Creates admin_roles + admin_users tables.
 * admin_users.admin_role_id is RESTRICT-deleted to keep audit references
 * meaningful even after a Role is deactivated.
 */
export class Migration006AdminUsersInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "admin_roles" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "permissions" jsonb not null default '[]'::jsonb,
        "requires_two_factor" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "admin_roles_pkey" primary key ("id"),
        constraint "admin_roles_code_unique" unique ("code")
      );
    `);

    this.addSql(`
      create table "admin_users" (
        "id" uuid not null,
        "email" varchar(320) not null,
        "password_hash" varchar(512) not null,
        "first_name" varchar(120) not null,
        "last_name" varchar(120) not null,
        "admin_role_id" uuid null,
        "status" varchar(16) not null default 'active',
        "two_factor_secret" varchar(64) null,
        "two_factor_confirmed_at" timestamptz null,
        "last_login_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "admin_users_pkey" primary key ("id"),
        constraint "admin_users_email_unique" unique ("email"),
        constraint "admin_users_admin_role_fk" foreign key ("admin_role_id")
          references "admin_roles" ("id") on delete restrict
      );
    `);
    this.addSql('create index "admin_users_admin_role_id_index" on "admin_users" ("admin_role_id");');
    this.addSql('create index "admin_users_status_index" on "admin_users" ("status");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "admin_users" cascade;');
    this.addSql('drop table if exists "admin_roles" cascade;');
  }
}
