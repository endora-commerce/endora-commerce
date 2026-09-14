import { Migration } from '@mikro-orm/migrations';

/** Feature 119 — `erp_connector` shared layer (init). */
export class Migration20260911T120000ErpConnectorInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "erp_connector_activation_lock" (
        "id" uuid not null,
        "active_module_id" varchar(64) null,
        "updated_at" timestamptz not null,
        "updated_by_admin_id" uuid null,
        constraint "erp_connector_activation_lock_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "erp_connector_activation_lock"
        add constraint "erp_connector_activation_lock_updated_by_admin_id_foreign"
        foreign key ("updated_by_admin_id") references "admin_users" ("id")
        on update cascade on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "erp_connector_activation_lock" cascade;`);
  }
}
