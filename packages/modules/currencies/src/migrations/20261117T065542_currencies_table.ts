import { Migration } from '@mikro-orm/migrations';

/**
 * The `currencies` table, its two indexes, its two shipped rows and the
 * `symbol_position` / `decimal_places` columns with their checks, created by
 * the module whose `Currency` entity maps them.
 *
 * Until issue #611 `currencies` had no migration. `languages`' frozen
 * `Migration20260425T161557LanguagesCurrenciesInit` created the table and
 * inserted `PLN` and `EUR`, and `dictionaries`' frozen
 * `Migration20260506T112634DictionariesDictionaryInit` added the two columns
 * and their checks. That is two other modules' migrations deciding this
 * module's schema and rows, which the migration table-ownership rule
 * (feature 097, R2) refuses. Both frozen inits keep their class names and lost
 * only these statements and their inverses, the shape D-226 gave the
 * `cms_pages` index that `assets_library`'s frozen init carried. This block
 * runs after the whole frozen prefix, so the `countries_default_currency_fk`
 * that the `dictionaries` init added moved too, to
 * `Migration20261117T065601DictionariesDefaultCurrencyFk`.
 *
 * **Every statement is a no-op on a database that ran the frozen inits.** The
 * table and indexes are `if not exists`, the columns `add column if not
 * exists`, and the checks sit behind a `pg_constraint` probe, because
 * PostgreSQL has no `add constraint if not exists`. The definitions are the
 * frozen statements verbatim, so both paths reach one schema.
 *
 * **The seed runs only when this migration created the table.** A
 * `to_regclass` probe before the create decides it, inside one `do` block. A
 * plain `on conflict do nothing` insert would put back a currency the operator
 * deleted, and its `PLN` row would fight `uniq_currencies_one_default` once the
 * operator had made another currency the default. The rows are the frozen
 * insert verbatim, Unicode literals included, so the source stays ASCII.
 *
 * `down()` drops the table, because this module creates it.
 */
export class Migration20261117T065542CurrenciesTable extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if to_regclass('public.currencies') is null then
          create table if not exists "currencies" (
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
          insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
          values
            ('PLN', 'Polish zloty', U&'z\\0142', true, true, 0, now(), now()),
            ('EUR', 'Euro', U&'\\20AC', false, true, 1, now(), now());
        end if;
      end $$;
    `);
    this.addSql(
      'create unique index if not exists "uniq_currencies_one_default" on "currencies" ("is_default") where "is_default" = true;',
    );
    this.addSql('create index if not exists "currencies_is_active_index" on "currencies" ("is_active");');

    this.addSql(
      `alter table "currencies" add column if not exists "symbol_position" varchar(8) not null default 'suffix';`,
    );
    this.addSql(`alter table "currencies" add column if not exists "decimal_places" smallint not null default 2;`);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'currencies_symbol_position_check'
            and "conrelid" = '"currencies"'::regclass
        ) then
          alter table "currencies"
            add constraint "currencies_symbol_position_check"
            check ("symbol_position" in ('prefix','suffix'));
        end if;
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'currencies_decimal_places_check'
            and "conrelid" = '"currencies"'::regclass
        ) then
          alter table "currencies"
            add constraint "currencies_decimal_places_check"
            check ("decimal_places" >= 0 and "decimal_places" <= 6);
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "currencies" cascade;');
  }
}
