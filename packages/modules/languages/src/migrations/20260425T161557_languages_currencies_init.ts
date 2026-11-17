import { Migration } from '@mikro-orm/migrations';

/**
 * Languages init (T238 / FR-105). The `languages` configuration table, with a
 * partial unique index pinning at most one default row.
 *
 * The class name still says "currencies" because the file used to create
 * both tables. They were co-located in the `languages` module folder to keep
 * the migration sequence numerical without inventing a third placeholder
 * module. Until issue #611 it also created the `currencies` table and its two
 * indexes, inserted the `PLN` and `EUR` rows, and dropped the table in
 * `down()`. Those are `currencies`' — its `Currency` entity maps the table —
 * so the statements moved to `Migration20261117T065542CurrenciesTable`,
 * verbatim and `if not exists`, with the seed guarded on that migration
 * creating the table. This is the shape D-226 gave the `cms_pages` index that
 * `assets_library`'s frozen init carried. This class keeps its name, so a
 * database that has applied it is not offered it again, and its schema and
 * rows are unchanged.
 */
export class Migration20260425T161557LanguagesCurrenciesInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "languages" (
        "code" varchar(12) not null,
        "label" varchar(64) not null,
        "is_default" boolean not null default false,
        "is_active" boolean not null default true,
        "sort_order" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "languages_pkey" primary key ("code")
      );
    `);
    this.addSql(
      'create unique index "uniq_languages_one_default" on "languages" ("is_default") where "is_default" = true;',
    );
    this.addSql('create index "languages_is_active_index" on "languages" ("is_active");');

    // Bootstrap with the project defaults so quickstart works without an
    // additional admin step. en-US matches the existing seed data.
    this.addSql(
      `insert into "languages" ("code", "label", "is_default", "is_active", "sort_order", "created_at", "updated_at")
       values
         ('en-US', 'English (US)', true, true, 0, now(), now()),
         ('pl-PL', 'Polski', false, true, 1, now(), now());`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "languages" cascade;');
  }
}
