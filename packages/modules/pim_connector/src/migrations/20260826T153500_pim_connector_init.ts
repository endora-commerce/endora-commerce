import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 089 — `pim_connector` shared layer (init).
 *
 * Creates `pim_connector_activation_lock` per data-model.md.
 */
export class Migration20260826T153500PimConnectorInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "pim_connector_activation_lock" (
        "id" uuid not null,
        "active_module_id" varchar(64) null,
        "updated_at" timestamptz not null,
        "updated_by_admin_id" uuid null,
        constraint "pim_connector_activation_lock_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "pim_connector_activation_lock"
        add constraint "pim_connector_activation_lock_updated_by_admin_id_foreign"
        foreign key ("updated_by_admin_id") references "admin_users" ("id")
        on update cascade on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pim_connector_activation_lock" cascade;`);
  }
}
