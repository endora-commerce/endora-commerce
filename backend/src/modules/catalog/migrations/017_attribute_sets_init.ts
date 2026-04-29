import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Attribute Sets (T014).
 *
 * Adds the AttributeSet domain on top of foundation 001:
 *   - `attribute_sets`: named container of Product Attributes.
 *   - `attribute_set_attributes`: composite-PK bridge to
 *     `product_attributes` with a `position` column.
 *   - Idempotent seed of the system **Default** Attribute Set with a
 *     deterministic UUID so every Product can reference it without
 *     application-level lookup.
 *   - `products.attribute_set_id`: NOT NULL FK pointing at the Default
 *     set on existing rows; new rows pick the Set explicitly.
 *
 * See specs/002-catalog-module/data-model.md §2.1, §2.2, §1.1.
 *
 * Naming follows Principle VI:
 *   - Plural snake_case tables.
 *   - FK columns named `{singular}_id`.
 *   - Unique / index constraint names prefixed with table name.
 */
export class Migration017AttributeSetsInit extends Migration {
  /**
   * Deterministic UUID for the system Default Attribute Set. Hard-coded
   * so seeds, contract tests, and integration tests can reference it
   * without a lookup query, and so backfilling existing Products on this
   * migration is a single UPDATE rather than two queries.
   */
  static readonly DEFAULT_ATTRIBUTE_SET_ID =
    'defa0017-0000-4000-8000-000000000000'; // mnemonic: default + migration 017; valid UUID v4 (version=4, variant=8)

  override async up(): Promise<void> {
    // -- attribute_sets -------------------------------------------------------
    this.addSql(`
      create table "attribute_sets" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "description" jsonb null,
        "is_system" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "attribute_sets_pkey" primary key ("id"),
        constraint "uniq_attribute_sets_code" unique ("code")
      );
    `);

    // Idempotent seed of the system Default set.
    this.addSql(`
      insert into "attribute_sets"
        ("id", "code", "name", "description", "is_system", "created_at", "updated_at")
      values
        ('${Migration017AttributeSetsInit.DEFAULT_ATTRIBUTE_SET_ID}',
         'default',
         '{"en-US":"Default","pl-PL":"Domyślny"}'::jsonb,
         '{"en-US":"System default attribute set assigned to every product unless explicitly changed.","pl-PL":"Systemowy domyślny zbiór atrybutów przypisywany do każdego produktu, dopóki administrator go nie zmieni."}'::jsonb,
         true,
         now(),
         now())
      on conflict ("code") do nothing;
    `);

    // -- attribute_set_attributes (M:N bridge) -------------------------------
    this.addSql(`
      create table "attribute_set_attributes" (
        "attribute_set_id" uuid not null,
        "product_attribute_id" uuid not null,
        "position" int not null default 0,
        constraint "attribute_set_attributes_pkey"
          primary key ("attribute_set_id", "product_attribute_id"),
        constraint "fk_attribute_set_attributes_set"
          foreign key ("attribute_set_id")
          references "attribute_sets" ("id")
          on delete cascade,
        constraint "fk_attribute_set_attributes_attribute"
          foreign key ("product_attribute_id")
          references "product_attributes" ("id")
          on delete restrict
      );
    `);
    this.addSql(
      'create index "attribute_set_attributes_set_id_index" on "attribute_set_attributes" ("attribute_set_id");',
    );
    this.addSql(
      'create index "attribute_set_attributes_attribute_id_index" on "attribute_set_attributes" ("product_attribute_id");',
    );

    // -- products.attribute_set_id -------------------------------------------
    // Backfill in three steps so the constraint is enforceable on
    // pre-existing rows:
    //   1. Add the column nullable with a default of the Default set ID.
    //   2. Update all rows whose value is NULL to the Default set ID
    //      (handles any legacy NULL state, even though the default makes
    //      this a no-op for greenfield).
    //   3. Tighten to NOT NULL and add the FK + index.
    this.addSql(`
      alter table "products"
        add column "attribute_set_id" uuid
        default '${Migration017AttributeSetsInit.DEFAULT_ATTRIBUTE_SET_ID}'::uuid;
    `);
    this.addSql(`
      update "products"
        set "attribute_set_id" = '${Migration017AttributeSetsInit.DEFAULT_ATTRIBUTE_SET_ID}'::uuid
        where "attribute_set_id" is null;
    `);
    this.addSql(`
      alter table "products"
        alter column "attribute_set_id" set not null;
    `);
    this.addSql(`
      alter table "products"
        add constraint "fk_products_attribute_set"
          foreign key ("attribute_set_id")
          references "attribute_sets" ("id")
          on delete restrict;
    `);
    this.addSql(
      'create index "products_attribute_set_id_index" on "products" ("attribute_set_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "products_attribute_set_id_index";');
    this.addSql(
      'alter table "products" drop constraint if exists "fk_products_attribute_set";',
    );
    this.addSql('alter table "products" drop column if exists "attribute_set_id";');
    this.addSql('drop table if exists "attribute_set_attributes" cascade;');
    this.addSql('drop table if exists "attribute_sets" cascade;');
  }
}
