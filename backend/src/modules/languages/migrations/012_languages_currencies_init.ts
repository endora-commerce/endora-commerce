import { Migration } from '@mikro-orm/migrations';

/**
 * Languages + currencies init (T238 / FR-105). Two configuration tables
 * with a partial unique index pinning at most one default row each.
 *
 * Co-located in the `languages` module folder to keep the migration
 * sequence numerical without inventing a third placeholder module.
 */
export class Migration012LanguagesCurrenciesInit extends Migration {
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

    this.addSql(`
      create table "currencies" (
        "code" varchar(3) not null,
        "label" varchar(64) not null,
        "symbol" varchar(8) not null,
        "is_default" boolean not null default false,
        "is_active" boolean not null default true,
        "sort_order" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "currencies_pkey" primary key ("code")
      );
    `);
    this.addSql(
      'create unique index "uniq_currencies_one_default" on "currencies" ("is_default") where "is_default" = true;',
    );
    this.addSql('create index "currencies_is_active_index" on "currencies" ("is_active");');

    // Bootstrap with the project defaults so quickstart works without an
    // additional admin step. en-US + PLN match the existing seed data.
    // Customer-facing label / symbol values use Postgres U&'…' Unicode
    // literals so the source file stays ASCII-only (Principle VIII's
    // engineering-artifact constraint), while the runtime row reflects
    // exactly what the storefront should render.
    this.addSql(
      `insert into "languages" ("code", "label", "is_default", "is_active", "sort_order", "created_at", "updated_at")
       values
         ('en-US', 'English (US)', true, true, 0, now(), now()),
         ('pl-PL', 'Polski', false, true, 1, now(), now());`,
    );
    this.addSql(
      `insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
       values
         ('PLN', 'Polish zloty', U&'z\\0142', true, true, 0, now(), now()),
         ('EUR', 'Euro', U&'\\20AC', false, true, 1, now(), now());`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "currencies" cascade;');
    this.addSql('drop table if exists "languages" cascade;');
  }
}
