import { Migration } from '@mikro-orm/migrations';

/**
 * The tenant-key index on `newsletter_subscribers.customer_account_id`
 * (feature 050, research §R5).
 *
 * It was created by the platform's frozen
 * `Migration20260717T134752CoreTenantScopeIndexes` until
 * `specs/120-migration-closure-bridge-ownership/` Phase 3. Under D-226 the
 * platform declares no dependencies and so can never name a module's table:
 * an instance that omits `newsletter` had a frozen corpus indexing a table
 * nothing builds. `newsletter_subscribers` is this module's own table, so
 * the closure here is trivial.
 *
 * The statement is the frozen one verbatim, `if not exists` and all. A
 * database that has already applied the frozen migration is offered nothing
 * from it — the storage keys on the class name and holds no checksum — and
 * this one is the no-op it already reads as.
 */
export class Migration20260912T125702NewsletterSubscriberTenantScopeIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create index if not exists "newsletter_subscribers_customer_account_id_index" on "newsletter_subscribers" ("customer_account_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "newsletter_subscribers_customer_account_id_index";');
  }
}
