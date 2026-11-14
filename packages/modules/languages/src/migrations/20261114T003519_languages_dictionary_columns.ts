import { Migration } from '@mikro-orm/migrations';

/**
 * `languages.native_label`, `is_rtl` and `fallback_code`, and the
 * `languages_fallback_fk` self-reference (feature 017), created by the module
 * whose `Language` entity maps them (`nativeLabel`, `isRtl`, `fallbackCode`).
 *
 * Until issue #611 the only migration creating them was `dictionaries`' frozen
 * `Migration20260506T112634DictionariesDictionaryInit`, so another module's
 * migration decided this module's schema — the write the migration
 * table-ownership rule (feature 097, R2) refuses, whether or not `dictionaries`
 * declares this module, which it does. The frozen init keeps its class name and
 * lost only these statements and their inverses, the shape D-226 gave the
 * `cms_pages` index `assets_library`'s frozen init carried
 * (`Migration20260912T125709CmsPageBodyAssetRefIndex`). The values are still
 * back-filled at boot by `dictionaries`' seed reconciler, as before.
 *
 * **`if not exists` and a `pg_constraint` probe**, because every database
 * that ran the frozen init already has all four, and there this must be a
 * no-op that keeps every value. PostgreSQL has no `add constraint if not
 * exists`. Types, defaults, nullability and `on delete set null` are the frozen
 * statements verbatim, so the two paths reach one schema. `down()` drops all
 * four, as the frozen init's did: this module creates `languages` itself, so
 * the table does not outlive it.
 */
export class Migration20261114T003519LanguagesDictionaryColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "languages" add column if not exists "native_label" varchar(64) not null default '';`);
    this.addSql(`alter table "languages" add column if not exists "is_rtl" boolean not null default false;`);
    this.addSql(`alter table "languages" add column if not exists "fallback_code" varchar(12) null;`);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'languages_fallback_fk'
            and "conrelid" = '"languages"'::regclass
        ) then
          alter table "languages"
            add constraint "languages_fallback_fk"
            foreign key ("fallback_code") references "languages" ("code")
            on delete set null;
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "languages" drop constraint if exists "languages_fallback_fk";`);
    this.addSql(`alter table "languages" drop column if exists "fallback_code";`);
    this.addSql(`alter table "languages" drop column if exists "is_rtl";`);
    this.addSql(`alter table "languages" drop column if exists "native_label";`);
  }
}
