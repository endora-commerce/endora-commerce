import { Migration } from '@mikro-orm/migrations';

/**
 * Queued product bulk-edit — `catalog_bulk_operations`.
 *
 * Backs the asynchronous bulk-edit path: selections above the
 * synchronous threshold are persisted here and processed by the
 * in-process sweeper instead of being applied inline. Live counters
 * (`processed` / `succeeded` / `skipped` / `failed`) drive the
 * "Bulk actions" admin page; `payload` keeps the original request and
 * `results` the per-product outcome list once the run finishes.
 */
export class Migration20260611T140407CatalogBulkOperations extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "catalog_bulk_operations" (
        "id" uuid not null,
        "type" varchar(64) not null default 'product_bulk_update',
        "status" varchar(16) not null default 'pending',
        "requested_by_admin_user_id" uuid not null,
        "total" int not null,
        "processed" int not null default 0,
        "succeeded" int not null default 0,
        "skipped" int not null default 0,
        "failed" int not null default 0,
        "payload" jsonb not null,
        "results" jsonb null,
        "error" text null,
        "created_at" timestamptz not null,
        "started_at" timestamptz null,
        "finished_at" timestamptz null,
        constraint "catalog_bulk_operations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      'create index "catalog_bulk_operations_status_index" on "catalog_bulk_operations" ("status");',
    );
    this.addSql(
      'create index "catalog_bulk_operations_requested_by_admin_user_id_index" on "catalog_bulk_operations" ("requested_by_admin_user_id");',
    );
    this.addSql(
      'create index "catalog_bulk_operations_created_at_index" on "catalog_bulk_operations" ("created_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_bulk_operations" cascade;');
  }
}
