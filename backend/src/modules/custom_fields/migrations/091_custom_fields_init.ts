import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 055 — Custom Fields Layer (init).
 *
 * Creates the two entity-agnostic module tables:
 *   - `custom_field_definitions` — operator-defined typed fields per host
 *     entity type (unique `(entity_type, key)`), with per-locale label +
 *     fallback, value type, required flag, ordering, and an opaque `config`
 *     JSONB for host-capability opt-in the generic core never interprets.
 *   - `custom_field_options` — select/multiselect option lists (unique
 *     `(definition_id, value)`, FK ON DELETE CASCADE).
 *
 * The per-host `custom_field_values` JSONB columns are added additively by the
 * host modules (migrations 092–096). `product_attributes` is untouched (FR-011).
 */
export class Migration091CustomFieldsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "custom_field_definitions" (
        "id" uuid not null,
        "entity_type" varchar(32) not null,
        "key" varchar(64) not null,
        "label" jsonb not null default '{}',
        "label_default" varchar(200) not null,
        "value_type" varchar(16) not null,
        "required" boolean not null default false,
        "sort_order" int not null default 0,
        "config" jsonb not null default '{}',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "custom_field_definitions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "custom_field_definitions" add constraint "custom_field_definitions_entity_key_unique" unique ("entity_type", "key");`,
    );
    this.addSql(
      `create index "custom_field_definitions_entity_type_idx" on "custom_field_definitions" ("entity_type");`,
    );

    this.addSql(`
      create table "custom_field_options" (
        "id" uuid not null,
        "definition_id" uuid not null,
        "value" varchar(200) not null,
        "label" jsonb not null default '{}',
        "label_default" varchar(200) not null,
        "is_default" boolean not null default false,
        "sort_order" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "custom_field_options_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "custom_field_options" add constraint "custom_field_options_definition_value_unique" unique ("definition_id", "value");`,
    );
    this.addSql(
      `create index "custom_field_options_definition_idx" on "custom_field_options" ("definition_id");`,
    );
    this.addSql(
      `alter table "custom_field_options" add constraint "custom_field_options_definition_fk" ` +
        `foreign key ("definition_id") references "custom_field_definitions" ("id") on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "custom_field_options" cascade;`);
    this.addSql(`drop table if exists "custom_field_definitions" cascade;`);
  }
}
