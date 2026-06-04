import { Migration } from '@mikro-orm/migrations';

/**
 * Bulk-operation lifecycle logs — adds `logs` to `catalog_bulk_operations`.
 *
 * Holds an ordered list of timestamped lifecycle events (created / started /
 * completed / failed, plus notable milestones) so the bulk-operations detail
 * view can show "what happened, when" alongside the per-element `results`.
 * Nullable — rows predating this migration simply have no log trail.
 */
export class Migration066BulkOperationLogs extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "catalog_bulk_operations" add column "logs" jsonb null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "catalog_bulk_operations" drop column "logs";');
  }
}
