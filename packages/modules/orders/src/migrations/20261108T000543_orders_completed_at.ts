import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #905 (design D3.1–D3.3) — `orders.completed_at`: the moment the order
 * entered `completed`, stamped once by `OrderTransitionService` and never
 * rewritten. It is the anchor `OrderReturnContextPort` reports, from which the
 * free-return window and the consumer's withdrawal period are counted.
 *
 * **Backfill.** An order already in `completed` gets its `updated_at`: exactly
 * the anchor it was judged by until now, so no existing order changes
 * behaviour — the anchor only stops drifting from here on. It is an
 * approximation (an order edited after completing carries the later edit), and
 * the only one there is: nothing recorded the moment itself. Every other row
 * stays `null`, which means "not completed": the period has not started.
 *
 * Own table only (`module-migrations.md` item 4a, R2). Idempotent: the column is
 * added if absent and only unstamped rows are filled.
 */
export class Migration20261108T000543OrdersCompletedAt extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "orders" add column if not exists "completed_at" timestamptz null;');
    this.addSql(
      `update "orders" set "completed_at" = "updated_at" where "status" = 'completed' and "completed_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "orders" drop column if exists "completed_at";');
  }
}
