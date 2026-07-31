import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 064 — Meta Ads. Creates `meta_custom_event_mappings`.
 *
 * Channel configuration (enabled, pixel id, consent) lives in the Settings
 * module and needs no schema here.
 */
export class Migration20260728T002715MetaAdsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "meta_custom_event_mappings" (
        "id" uuid not null,
        "sales_channel_id" uuid null,
        "trigger_action" varchar(32) not null,
        "event_name" varchar(64) not null,
        "enabled" boolean not null default true,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "meta_custom_event_mappings_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "meta_custom_event_mappings"
        add constraint "meta_custom_event_mappings_sales_channel_id_foreign"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(
      'create index "meta_custom_event_mappings_channel_action_idx" on "meta_custom_event_mappings" ("sales_channel_id", "trigger_action");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "meta_custom_event_mappings" cascade;');
  }
}
