import { Migration } from '@mikro-orm/migrations';

/**
 * Credit Limit module — Phase 8 (T212).
 *
 * - One CreditLimit row per Organization (partial unique index — soft-revoked
 *   rows aren't unique, but at most one "live" grant per org).
 * - CreditLimitReservation indexed on (credit_limit_id, status) so the FOR
 *   UPDATE inside the order-placement transaction can sum active reservations
 *   cheaply.
 */
export class Migration008CreditLimitsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "credit_limits" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "granted_amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "granted_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "credit_limits_pkey" primary key ("id"),
        constraint "credit_limits_org_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete restrict
      );
    `);
    this.addSql('create index "credit_limits_organization_id_index" on "credit_limits" ("organization_id");');
    this.addSql(
      `create unique index "credit_limits_one_per_organization" on "credit_limits" ("organization_id");`,
    );

    this.addSql(`
      create table "credit_limit_reservations" (
        "id" uuid not null,
        "credit_limit_id" uuid not null,
        "order_id" uuid not null,
        "amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "status" varchar(16) not null default 'active',
        "released_at" timestamptz null,
        "released_reason" varchar(32) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "credit_limit_reservations_pkey" primary key ("id"),
        constraint "credit_limit_reservations_credit_limit_fk" foreign key ("credit_limit_id")
          references "credit_limits" ("id") on delete restrict
      );
    `);
    this.addSql('create index "credit_limit_reservations_credit_limit_status_index" on "credit_limit_reservations" ("credit_limit_id", "status");');
    this.addSql('create index "credit_limit_reservations_order_id_index" on "credit_limit_reservations" ("order_id");');
    // At most one active reservation per order (idempotency guard).
    this.addSql(
      `create unique index "credit_limit_reservations_one_active_per_order" on "credit_limit_reservations" ("order_id") where "status" = 'active';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "credit_limit_reservations" cascade;');
    this.addSql('drop table if exists "credit_limits" cascade;');
  }
}
