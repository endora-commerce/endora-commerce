import { Migration } from '@mikro-orm/migrations';

/**
 * Settings module — feature 004 / data-model.md.
 *
 * Five tables + one enum:
 *   - setting_groups          (logical sections in Admin UI)
 *   - settings                (one row per knob; FK → setting_groups)
 *   - setting_values          (per (setting, sales_channel) admin override)
 *   - setting_group_sales_channels  (M:N scope; empty ⇒ all channels)
 *   - setting_sales_channels        (M:N scope; empty ⇒ all channels)
 *   - setting_value_type      (Postgres enum)
 *
 * The migration is purely structural; the `general` group and any other
 * built-in entries arrive via the boot-time manifest reconciler (R-1).
 */
export class Migration20260430T101450SettingsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create type "setting_value_type" as enum
        ('string', 'number', 'boolean', 'json', 'string_list');
    `);

    this.addSql(`
      create table "setting_groups" (
        "id" uuid not null,
        "code" varchar(120) not null,
        "name" varchar(200) not null,
        "is_system_protected" boolean not null default false,
        "owner_module" varchar(120) not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "setting_groups_pkey" primary key ("id"),
        constraint "setting_groups_code_unique" unique ("code")
      );
    `);
    this.addSql(
      'create index "setting_groups_owner_module_index" on "setting_groups" ("owner_module");',
    );

    this.addSql(`
      create table "settings" (
        "id" uuid not null,
        "code" varchar(160) not null,
        "name" varchar(200) not null,
        "group_id" uuid not null,
        "value_type" "setting_value_type" not null,
        "default_value" jsonb not null,
        "owner_module" varchar(120) not null,
        "description" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "settings_pkey" primary key ("id"),
        constraint "settings_code_unique" unique ("code"),
        constraint "settings_group_fk" foreign key ("group_id")
          references "setting_groups" ("id") on delete restrict
      );
    `);
    this.addSql('create index "settings_group_id_index" on "settings" ("group_id");');
    this.addSql(
      'create index "settings_owner_module_index" on "settings" ("owner_module");',
    );

    this.addSql(`
      create table "setting_values" (
        "id" uuid not null,
        "setting_id" uuid not null,
        "sales_channel_id" uuid not null,
        "value" jsonb not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "setting_values_pkey" primary key ("id"),
        constraint "setting_values_setting_channel_unique" unique ("setting_id", "sales_channel_id"),
        constraint "setting_values_setting_fk" foreign key ("setting_id")
          references "settings" ("id") on delete cascade,
        constraint "setting_values_sales_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "setting_values_setting_id_index" on "setting_values" ("setting_id");',
    );
    this.addSql(
      'create index "setting_values_sales_channel_id_index" on "setting_values" ("sales_channel_id");',
    );

    this.addSql(`
      create table "setting_group_sales_channels" (
        "setting_group_id" uuid not null,
        "sales_channel_id" uuid not null,
        constraint "setting_group_sales_channels_pkey"
          primary key ("setting_group_id", "sales_channel_id"),
        constraint "setting_group_sales_channels_group_fk"
          foreign key ("setting_group_id") references "setting_groups" ("id") on delete cascade,
        constraint "setting_group_sales_channels_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade
      );
    `);

    this.addSql(`
      create table "setting_sales_channels" (
        "setting_id" uuid not null,
        "sales_channel_id" uuid not null,
        constraint "setting_sales_channels_pkey"
          primary key ("setting_id", "sales_channel_id"),
        constraint "setting_sales_channels_setting_fk"
          foreign key ("setting_id") references "settings" ("id") on delete cascade,
        constraint "setting_sales_channels_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "setting_sales_channels" cascade;');
    this.addSql('drop table if exists "setting_group_sales_channels" cascade;');
    this.addSql('drop table if exists "setting_values" cascade;');
    this.addSql('drop table if exists "settings" cascade;');
    this.addSql('drop table if exists "setting_groups" cascade;');
    this.addSql('drop type if exists "setting_value_type";');
  }
}
