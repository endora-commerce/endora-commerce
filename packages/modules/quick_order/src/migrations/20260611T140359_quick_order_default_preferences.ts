import { Migration } from '@mikro-orm/migrations';

/**
 * Quick-order default ordering preferences (feature 039 — US2).
 *
 * One row per target (`scope` = organization | customer, `scope_id` = its id)
 * holding four nullable default references. A customer row overrides the
 * organization row per field; resolution is in the service. FKs are
 * `ON DELETE SET NULL` so removing a method / address degrades the default to
 * "unset" rather than blocking (FR-020).
 */
export class Migration20260611T140359QuickOrderDefaultPreferences extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "quick_order_default_preferences" (
        "id" uuid not null,
        "scope" varchar(16) not null,
        "scope_id" uuid not null,
        "default_payment_method_id" uuid null,
        "default_delivery_method_id" uuid null,
        "default_billing_address_id" uuid null,
        "default_shipping_address_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "quick_order_default_preferences_pkey" primary key ("id"),
        constraint "quick_order_default_preferences_scope_check"
          check ("scope" in ('organization', 'customer'))
      );
    `);

    this.addSql(`
      create unique index "quick_order_default_preferences_scope_target_uq"
        on "quick_order_default_preferences" ("scope", "scope_id");
    `);
    this.addSql(`
      create index "quick_order_default_preferences_scope_id_idx"
        on "quick_order_default_preferences" ("scope_id");
    `);

    this.addSql(`
      alter table "quick_order_default_preferences"
        add constraint "qodp_payment_method_fk"
          foreign key ("default_payment_method_id") references "payment_methods" ("id") on delete set null,
        add constraint "qodp_delivery_method_fk"
          foreign key ("default_delivery_method_id") references "delivery_methods" ("id") on delete set null,
        add constraint "qodp_billing_address_fk"
          foreign key ("default_billing_address_id") references "addresses" ("id") on delete set null,
        add constraint "qodp_shipping_address_fk"
          foreign key ("default_shipping_address_id") references "addresses" ("id") on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "quick_order_default_preferences";');
  }
}
