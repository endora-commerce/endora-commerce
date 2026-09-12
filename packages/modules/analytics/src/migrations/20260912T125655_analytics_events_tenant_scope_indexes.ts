import { Migration } from '@mikro-orm/migrations';

/**
 * The two tenant-key indexes on `analytics_events` (feature 050, research
 * §R5 — the guard filters on `organization_id` and `customer_account_id`,
 * and neither column was indexed).
 *
 * They were created by the platform's frozen
 * `Migration20260717T134752CoreTenantScopeIndexes` until
 * `specs/120-migration-closure-bridge-ownership/` Phase 3. Under D-226 a
 * migration may name a table only if its own module, its transitive
 * `dependencies` closure or the platform creates it; the platform declares
 * no dependencies, so it could never name `analytics_events`. An instance
 * that omits `analytics` had a frozen corpus indexing a table nothing
 * builds. The table is this module's own, so here the closure is trivial.
 *
 * The statements are the frozen ones verbatim, `if not exists` and all, so
 * the two paths reach one schema. A database that has already applied the
 * frozen migration is offered nothing from it — the storage keys on the
 * class name and holds no checksum — and these two are the no-ops they
 * already read as.
 *
 * The frozen migration's note is worth carrying: `analytics_events` can grow
 * large, and a plain in-transaction `CREATE INDEX` locks writes while it
 * builds. Ops may pre-create both CONCURRENTLY out of band, which
 * `if not exists` makes free.
 */
export class Migration20260912T125655AnalyticsEventsTenantScopeIndexes extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create index if not exists "analytics_events_organization_id_index" on "analytics_events" ("organization_id");',
    );
    this.addSql(
      'create index if not exists "analytics_events_customer_account_id_index" on "analytics_events" ("customer_account_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "analytics_events_organization_id_index";');
    this.addSql('drop index if exists "analytics_events_customer_account_id_index";');
  }
}
