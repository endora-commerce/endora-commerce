import { Migration } from '@mikro-orm/migrations';

/**
 * Analytics module init (T237 / FR-110, FR-111). Single append-only event
 * table. Indexes are tuned for the dashboard's two read patterns:
 *
 *   - "show me totals by type for the last 30 days"
 *   - "show me a daily breakdown of `product.viewed` for sales channel X"
 */
export class Migration010AnalyticsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "analytics_events" (
        "id" uuid not null,
        "type" varchar(64) not null,
        "occurred_at" timestamptz not null,
        "recorded_at" timestamptz not null,
        "sales_channel_id" uuid null,
        "customer_account_id" uuid null,
        "organization_id" uuid null,
        "session_id" varchar(64) null,
        "properties" jsonb null,
        "request_id" varchar(64) null,
        constraint "analytics_events_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "analytics_events_occurred_at_index" on "analytics_events" ("occurred_at");');
    this.addSql('create index "analytics_events_sales_channel_id_index" on "analytics_events" ("sales_channel_id");');
    this.addSql('create index "idx_analytics_events_type_occurred_at" on "analytics_events" ("type", "occurred_at");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "analytics_events" cascade;');
  }
}
