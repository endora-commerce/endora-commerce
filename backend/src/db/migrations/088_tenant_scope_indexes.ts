import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 050 — index the tenant-key columns the guard filters on, where the
 * index audit (research §R5) found a gap. Most org/customer-scoped tables were
 * already indexed on their tenant key; these three were not.
 *
 * NOTE for large tables: `analytics_events` can grow large in production. Prefer
 * building these indexes CONCURRENTLY out-of-band before a deploy (a plain
 * in-transaction `CREATE INDEX` locks writes while it builds). They are kept as
 * plain statements here for test/dev schema parity; ops may pre-create them
 * concurrently, and `IF NOT EXISTS` makes this migration a no-op in that case.
 */
export class Migration088TenantScopeIndexes extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create index if not exists "analytics_events_organization_id_index" on "analytics_events" ("organization_id");',
    );
    this.addSql(
      'create index if not exists "analytics_events_customer_account_id_index" on "analytics_events" ("customer_account_id");',
    );
    this.addSql(
      'create index if not exists "newsletter_subscribers_customer_account_id_index" on "newsletter_subscribers" ("customer_account_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "analytics_events_organization_id_index";');
    this.addSql('drop index if exists "analytics_events_customer_account_id_index";');
    this.addSql('drop index if exists "newsletter_subscribers_customer_account_id_index";');
  }
}
