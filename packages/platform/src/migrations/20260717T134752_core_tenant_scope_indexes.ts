import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 050 — index the tenant-key columns the guard filters on, where the
 * index audit (research §R5) found a gap. Most org/customer-scoped tables were
 * already indexed on their tenant key; these three were not.
 *
 * **It is empty since `specs/120-migration-closure-bridge-ownership/` Phase 3,
 * and the class stays.** All three indexes were on module-owned tables —
 * `analytics_events` twice and `newsletter_subscribers` once — and under D-226
 * the platform may name only what it creates itself: it declares no
 * dependencies, so it can never be ordered after a module's table, and an
 * instance omitting `analytics` or `newsletter` could not migrate a fresh
 * database at all. The statements moved to
 * `Migration20260912T125655AnalyticsEventsTenantScopeIndexes` and
 * `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`, verbatim.
 *
 * The class name is on `BASELINE_MIGRATIONS` and cannot go: `mikro_orm_migrations`
 * persists the name and no checksum, so every database that has already applied
 * this migration is offered nothing, and deleting the class would make it
 * pending nowhere while moving 70-odd frozen positions. An empty `up()` is what
 * a migration whose whole body moved elsewhere looks like.
 */
export class Migration20260717T134752CoreTenantScopeIndexes extends Migration {
  override async up(): Promise<void> {
    // Moved to the two modules that own the tables — see the class comment.
  }

  override async down(): Promise<void> {
    // Nothing to reverse: each moved statement is reversed by the migration
    // that now carries it.
  }
}
