import { Migration } from '@mikro-orm/migrations';

/**
 * `quote_requests.sales_channel_id` — the channel a quote request was raised
 * on (feature 005, FR-012).
 *
 * The column, its foreign key and its index were added by the platform's
 * frozen `Migration20260430T170044CoreSalesChannelsPromote` until
 * `specs/120-migration-closure-bridge-ownership/` Phase 3. Under D-226 a
 * migration may name a table only if its own module creates it, a module in
 * its transitive `dependencies` closure creates it, or the platform creates
 * it — and the platform declares no dependencies, so it could never name
 * `quote_requests` at all. An instance that omits this module had a frozen
 * corpus altering a table nothing builds.
 *
 * Here the closure holds in both directions the SQL runs: `quote_requests` is
 * this module's own table, and `sales_channels` is the kernel's, created
 * inside the frozen prefix that every above-watermark migration runs after.
 * `sales_channels` is in this module's `dependencies` besides.
 *
 * **Written idempotently**, because a database that has already applied the
 * frozen migration carries all three objects. The storage keys on the class
 * name and holds no checksum, so the reduced frozen body is not re-offered
 * there; this migration is the no-op it reads as, and on a fresh database it
 * is the change. The constraint add is guarded by a `pg_constraint` probe
 * because PostgreSQL has no `add constraint if not exists`.
 *
 * The column stays NULLABLE, as it was: the backfill and the NOT NULL flip
 * are a separate step (feature 005 T060) and are not this migration's.
 */
export class Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "quote_requests" add column if not exists "sales_channel_id" uuid null;',
    );
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'quote_requests_sales_channel_fk'
            and "conrelid" = '"quote_requests"'::regclass
        ) then
          alter table "quote_requests"
            add constraint "quote_requests_sales_channel_fk"
            foreign key ("sales_channel_id") references "sales_channels" ("id")
            on delete restrict;
        end if;
      end $$;
    `);
    this.addSql(
      'create index if not exists "quote_requests_sales_channel_id_index" ' +
        'on "quote_requests" ("sales_channel_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "quote_requests_sales_channel_id_index";');
    this.addSql(
      'alter table "quote_requests" drop constraint if exists "quote_requests_sales_channel_fk";',
    );
    this.addSql('alter table "quote_requests" drop column if exists "sales_channel_id";');
  }
}
