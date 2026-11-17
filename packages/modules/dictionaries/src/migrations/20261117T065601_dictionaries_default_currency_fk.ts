import { Migration } from '@mikro-orm/migrations';

/**
 * `countries_default_currency_fk`, the foreign key from
 * `countries.default_currency_code` to `currencies(code)` (feature 017).
 *
 * Until issue #611 the frozen `Migration20260506T112634DictionariesDictionaryInit`
 * added it as its last step. Issue #611 moved the `currencies` table into
 * `currencies`' own `Migration20261117T065542CurrenciesTable`. That migration
 * runs in `currencies`' module block, after the whole frozen prefix, so the
 * frozen init would reference a table that does not exist yet on a database
 * migrated from empty. The statement moved here, above the watermark, where
 * this module's manifest `dependencies` (which list `currencies`) order it
 * after the table. The frozen init keeps its class name.
 *
 * **Behind a `pg_constraint` probe**, because every database that ran the
 * frozen init already has the constraint, and PostgreSQL has no `add
 * constraint if not exists`. The definition is the frozen statement verbatim.
 * `down()` drops only the constraint: the frozen init still owns `countries`.
 */
export class Migration20261117T065601DictionariesDefaultCurrencyFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'countries_default_currency_fk'
            and "conrelid" = '"countries"'::regclass
        ) then
          alter table "countries"
            add constraint "countries_default_currency_fk"
            foreign key ("default_currency_code") references "currencies" ("code")
            on delete set null;
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "countries" drop constraint if exists "countries_default_currency_fk";`);
  }
}
