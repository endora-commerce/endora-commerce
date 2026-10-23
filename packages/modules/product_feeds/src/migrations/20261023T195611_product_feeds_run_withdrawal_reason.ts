import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (FR-029), owner ruling 2026-10-23 — a run can withdraw the
 * published file.
 *
 * When a feed's pinned price book does not apply at generation time, the run
 * ends with the new status `withdrawn` (the existing `varchar(24)` takes it; no
 * check constraint names the statuses) and moves the publish pointer to
 * nothing. This column records why the book did not apply — one of
 * `pinnedPriceBookUnpublishableReasonSchema`'s reasons — and is null on every
 * other run, so no backfill.
 *
 * No foreign key, so the module's manifest `dependencies` are unchanged.
 */
export class Migration20261023T195611ProductFeedsRunWithdrawalReason extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_feed_runs" add column "withdrawal_reason" varchar(48) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_feed_runs" drop column "withdrawal_reason";`);
  }
}
