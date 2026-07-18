import { Migration } from '@mikro-orm/migrations';

/**
 * Reversible bulk operations — feature 054 (Command Bus, US2).
 *
 * Extends `catalog_bulk_operations` (feature 022's store; no parallel table) with
 * the per-record before/after snapshot and undo bookkeeping needed to undo a bulk
 * edit:
 *  - `revert_state`      — array of `{ recordId, before, after }` (research §R3/§R4);
 *  - `reversible`        — whether this operation captured revert data (drives the
 *                          operator-facing undo affordance, FR-004);
 *  - `undo_status`       — `none | reverted | partially_reverted` (idempotent-safe
 *                          re-invoke, FR-014);
 *  - `undone_at`         — when the undo completed;
 *  - `undo_operation_id` — links the undo's own audited action (FR-007).
 *
 * All additive + nullable/defaulted, so rows predating this migration remain
 * non-reversible with no backfill.
 */
export class Migration090BulkOperationRevertState extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "catalog_bulk_operations" add column "revert_state" jsonb null;');
    this.addSql(
      'alter table "catalog_bulk_operations" add column "reversible" boolean not null default false;',
    );
    this.addSql(
      `alter table "catalog_bulk_operations" add column "undo_status" varchar(24) not null default 'none';`,
    );
    this.addSql('alter table "catalog_bulk_operations" add column "undone_at" timestamptz null;');
    this.addSql(
      'alter table "catalog_bulk_operations" add column "undo_operation_id" uuid null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "catalog_bulk_operations" drop column "undo_operation_id";');
    this.addSql('alter table "catalog_bulk_operations" drop column "undone_at";');
    this.addSql('alter table "catalog_bulk_operations" drop column "undo_status";');
    this.addSql('alter table "catalog_bulk_operations" drop column "reversible";');
    this.addSql('alter table "catalog_bulk_operations" drop column "revert_state";');
  }
}
