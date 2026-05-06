import { Migration } from '@mikro-orm/migrations';

/**
 * Dictionary module — feature 017 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - new tables: countries, dictionary_translations, language_countries.
 *   - ALTER `languages` ADD COLUMN native_label, is_rtl, fallback_code (self-FK).
 *   - ALTER `currencies` ADD COLUMN symbol_position, decimal_places (CHECKs).
 *   - partial unique index `uniq_countries_one_default` for the "exactly one
 *     default" invariant (mirrors the analogous indexes on languages and
 *     currencies introduced by migration 012).
 *   - partial unique index `uniq_language_countries_primary_per_country`
 *     for the "at most one primary language per country" invariant.
 *   - btree indexes: `idx_countries_active`, `idx_countries_sort`,
 *     `idx_dict_translations_lang`, `idx_language_countries_country`.
 *   - FK `countries.default_currency_code` → `currencies(code)` ON DELETE
 *     SET NULL — added LAST (after seed inserts run via the runtime
 *     SeedReconciler) so the constraint is satisfied for every seeded row
 *     without the migration carrying ~250 inline INSERTs.
 *
 * No seed rows in this migration. The countries seed, the Polish
 * translations seed, the en-US/pl-PL language↔country primary associations,
 * and the back-fill of `currencies.symbol_position` / `decimal_places`
 * and `languages.native_label` / `is_rtl` are inserted by the runtime
 * `SeedReconciler` in `services/seed-reconciler.ts` so admin edits across
 * deploys stay safe (R6 + R8). The reconciler is idempotent and runs on
 * every backend boot via the dictionaries module plugin.
 */
export class Migration038DictionaryInit extends Migration {
  override async up(): Promise<void> {
    // ────────────────────────────────────────────────────────────────────
    // 1) countries — ISO 3166-1 alpha-2 territories
    //    FK to currencies(code) is added LAST in this migration (step 8).
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "countries" (
        "code" varchar(2) not null,
        "alpha3_code" varchar(3) not null,
        "numeric_code" varchar(3) not null,
        "label" varchar(120) not null,
        "region" varchar(32) not null,
        "subregion" varchar(64) null,
        "dial_code" varchar(8) null,
        "is_eu_member" boolean not null default false,
        "default_currency_code" varchar(3) null,
        "is_active" boolean not null default true,
        "is_default" boolean not null default false,
        "sort_order" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "countries_pkey" primary key ("code"),
        constraint "countries_alpha3_uniq" unique ("alpha3_code"),
        constraint "countries_numeric_uniq" unique ("numeric_code"),
        constraint "countries_region_check" check ("region" in
          ('Africa','Americas','Asia','Europe','Oceania','Antarctic'))
      );
    `);
    this.addSql(
      `create unique index "uniq_countries_one_default" on "countries" ("is_default") where "is_default" = true;`,
    );
    this.addSql(`create index "idx_countries_active" on "countries" ("is_active");`);
    this.addSql(`create index "idx_countries_sort" on "countries" ("sort_order", "label");`);

    // ────────────────────────────────────────────────────────────────────
    // 2) ALTER languages — extended fields (native_label, is_rtl, fallback_code)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`alter table "languages" add column "native_label" varchar(64) not null default '';`);
    this.addSql(`alter table "languages" add column "is_rtl" boolean not null default false;`);
    this.addSql(`alter table "languages" add column "fallback_code" varchar(12) null;`);
    this.addSql(`
      alter table "languages"
        add constraint "languages_fallback_fk"
        foreign key ("fallback_code") references "languages" ("code")
        on delete set null;
    `);

    // ────────────────────────────────────────────────────────────────────
    // 3) ALTER currencies — extended fields (symbol_position, decimal_places)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(
      `alter table "currencies" add column "symbol_position" varchar(8) not null default 'suffix';`,
    );
    this.addSql(`alter table "currencies" add column "decimal_places" smallint not null default 2;`);
    this.addSql(`
      alter table "currencies"
        add constraint "currencies_symbol_position_check"
        check ("symbol_position" in ('prefix','suffix'));
    `);
    this.addSql(`
      alter table "currencies"
        add constraint "currencies_decimal_places_check"
        check ("decimal_places" >= 0 and "decimal_places" <= 6);
    `);

    // ────────────────────────────────────────────────────────────────────
    // 4) dictionary_translations — polymorphic per-Language label override
    //    (parent-existence enforced at the service layer, R3)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "dictionary_translations" (
        "entry_type" varchar(16) not null,
        "entry_code" varchar(12) not null,
        "language_code" varchar(12) not null,
        "label" varchar(160) not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "dictionary_translations_pkey"
          primary key ("entry_type", "entry_code", "language_code"),
        constraint "dictionary_translations_lang_fk"
          foreign key ("language_code") references "languages" ("code") on delete cascade,
        constraint "dictionary_translations_entry_type_check"
          check ("entry_type" in ('country','currency','language'))
      );
    `);
    this.addSql(
      `create index "idx_dict_translations_lang" on "dictionary_translations" ("language_code");`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 5) language_countries — Language ↔ Country M2M with primary flag
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "language_countries" (
        "language_code" varchar(12) not null,
        "country_code" varchar(2) not null,
        "is_primary" boolean not null default false,
        "created_at" timestamptz not null,
        constraint "language_countries_pkey"
          primary key ("language_code", "country_code"),
        constraint "language_countries_lang_fk"
          foreign key ("language_code") references "languages" ("code") on delete cascade,
        constraint "language_countries_country_fk"
          foreign key ("country_code") references "countries" ("code") on delete cascade
      );
    `);
    this.addSql(
      `create unique index "uniq_language_countries_primary_per_country" on "language_countries" ("country_code") where "is_primary" = true;`,
    );
    this.addSql(
      `create index "idx_language_countries_country" on "language_countries" ("country_code");`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 6) FK countries.default_currency_code → currencies(code)
    //    Added LAST so the runtime SeedReconciler can backfill
    //    `default_currency_code` referring to currencies that may not yet
    //    exist when the migration runs against an empty database. The FK
    //    itself is enforced from this point forward.
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      alter table "countries"
        add constraint "countries_default_currency_fk"
        foreign key ("default_currency_code") references "currencies" ("code")
        on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "countries" drop constraint if exists "countries_default_currency_fk";`);
    this.addSql(`drop table if exists "language_countries" cascade;`);
    this.addSql(`drop table if exists "dictionary_translations" cascade;`);
    this.addSql(`alter table "currencies" drop constraint if exists "currencies_decimal_places_check";`);
    this.addSql(`alter table "currencies" drop constraint if exists "currencies_symbol_position_check";`);
    this.addSql(`alter table "currencies" drop column if exists "decimal_places";`);
    this.addSql(`alter table "currencies" drop column if exists "symbol_position";`);
    this.addSql(`alter table "languages" drop constraint if exists "languages_fallback_fk";`);
    this.addSql(`alter table "languages" drop column if exists "fallback_code";`);
    this.addSql(`alter table "languages" drop column if exists "is_rtl";`);
    this.addSql(`alter table "languages" drop column if exists "native_label";`);
    this.addSql(`drop table if exists "countries" cascade;`);
  }
}
