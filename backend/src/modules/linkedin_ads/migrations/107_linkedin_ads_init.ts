import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 063 — LinkedIn Ads. Creates `linkedin_conversion_mappings`.
 *
 * Channel configuration (enabled, partner id, consent, server-side, access
 * token) lives in the Settings module and needs no schema here.
 */
export class Migration107LinkedinAdsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "linkedin_conversion_mappings" (
        "id" uuid not null,
        "sales_channel_id" uuid null,
        "trigger_action" varchar(32) not null,
        "conversion_id" varchar(32) not null,
        "conversion_rule_urn" varchar(128) null,
        "enabled" boolean not null default true,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "linkedin_conversion_mappings_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "linkedin_conversion_mappings"
        add constraint "linkedin_conversion_mappings_sales_channel_id_foreign"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(
      'create index "linkedin_conversion_mappings_channel_action_idx" on "linkedin_conversion_mappings" ("sales_channel_id", "trigger_action");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "linkedin_conversion_mappings" cascade;');
  }
}
