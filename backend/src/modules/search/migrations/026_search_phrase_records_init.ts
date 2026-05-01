import { Migration } from '@mikro-orm/migrations';

/**
 * Search phrase records — feature 006 / T034 / data-model.md §1.1.
 *
 * Single-table migration owned by the search module. The table is
 * append-only; analytics aggregations slice it by sales_channel +
 * normalized phrase + time window.
 */
export class Migration026SearchPhraseRecordsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "search_phrase_records" (
        "id" uuid not null,
        "phrase" varchar(512) not null,
        "phrase_normalized" varchar(512) not null,
        "sales_channel_id" uuid not null,
        "result_count" integer not null,
        "recorded_at" timestamptz not null default now(),
        constraint "search_phrase_records_pkey" primary key ("id"),
        constraint "search_phrase_records_sales_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on delete restrict
      );
    `);

    // Aggregation query: phrases by channel and frequency over a window.
    this.addSql(`
      create index "idx_search_phrase_records_aggr"
        on "search_phrase_records" ("sales_channel_id", "phrase_normalized", "recorded_at" desc);
    `);

    // Ops dashboards / "most-recent searches".
    this.addSql(`
      create index "idx_search_phrase_records_recent"
        on "search_phrase_records" ("recorded_at" desc);
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "search_phrase_records" cascade;');
  }
}
