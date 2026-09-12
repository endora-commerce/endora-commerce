import { Migration } from '@mikro-orm/migrations';

/**
 * The `organization_warehouses` bridge — the warehouses an organization is
 * assigned (feature 026).
 *
 * It was created by `organizations`' frozen
 * `Migration20260611T140349OrganizationsConsolidation` until
 * `specs/120-migration-closure-bridge-ownership/` Phase 3, where its
 * `warehouses` foreign key named a table `organizations` neither owns nor
 * declares. That is D-226's bridge rule one namespace over: a bridge between
 * an always-present near side (`organizations`) and a switchable far side
 * (`inventory`) belongs to the far side, because only the far side can be
 * ordered after both tables — `inventory` declares `organizations`, and
 * `organizations` cannot declare `inventory` without inverting an edge that
 * already runs the other way.
 *
 * So an instance that does not install `inventory` no longer carries a
 * migration whose foreign key names `warehouses`, and one that does gets the
 * bridge with its far side. The payoff is the one the rule promises:
 * `module:uninstall --hard inventory` now reverts this table, because a hard
 * uninstall reverts by registry `moduleId`.
 *
 * `if not exists`, because every database that has already applied the
 * frozen migration has this table. The storage keys on the class name and
 * holds no checksum, so the reduced frozen body is not re-offered there and
 * this migration is the no-op it reads as; on a fresh database it is the
 * creation. The statements are the frozen ones verbatim — same columns, same
 * primary key, same two foreign keys — so the two paths reach one schema.
 */
export class Migration20260912T125716InventoryOrganizationWarehouses extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "organization_warehouses" (
        "organization_id" uuid not null,
        "warehouse_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "organization_warehouses_pkey"
          primary key ("organization_id", "warehouse_id"),
        constraint "organization_warehouses_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade,
        constraint "organization_warehouses_warehouse_fk"
          foreign key ("warehouse_id") references "warehouses" ("id") on delete cascade
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "organization_warehouses" cascade;');
  }
}
