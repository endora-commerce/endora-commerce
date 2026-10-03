import { Migration } from '@mikro-orm/migrations';

/**
 * Repairs a sales channel created with the bare `en` language code, which this
 * module's dictionary has never held.
 *
 * ## The defect
 *
 * The kernel's `DefaultChannelReconciler` inserted the system-default channel
 * with `languages = ["en"]` and `default_language = 'en'`, while this module's
 * init migration seeds `en-US` and `pl-PL` only. The admin PATCH re-validates
 * every listed code against this table — the unchanged `en` included — so on
 * every instance scaffolded before the fix, adding a language to the default
 * channel answered `409 DICTIONARY_ENTRY_NOT_FOUND`. The reconciler now inserts
 * `en-US`; this migration reaches the rows it already wrote.
 *
 * ## Exactly which rows
 *
 * A `sales_channels` row whose `languages` is exactly `["en"]` and whose
 * `default_language` is `'en'`, and only while `en` is **not** a row of
 * `languages` and `en-US` **is**. That shape is the reconciler's and nobody
 * else's: an admin write refuses a code the dictionary does not hold, and the
 * PATCH that could have moved the row off it is the one that was failing — so
 * no operator can have produced or kept it on purpose. An operator who did add
 * `en` to the dictionary made the code valid, and the row is then left alone.
 * The display `name` is not touched: it is free text keyed by language, and no
 * write validates its keys.
 *
 * Each repaired row gets `["en-US"]` / `'en-US'` and its `version` bumped by
 * one, so an admin form still holding the old version is refused with 412
 * rather than writing over the repair. A second run matches nothing.
 *
 * ## Why here
 *
 * `sales_channels` is the kernel's table, and a module migration writing a
 * kernel table is the permitted direction (`module-migrations.md` item 4a);
 * the kernel's own migration would instead have to read this module's table,
 * which is the direction the kernel boundary forbids. And this module is
 * `nonDeactivatable`, so every instance runs it. On a fresh database it is a
 * no-op: the channel is install-time state the boot reconciler creates after
 * the migrations, already with `en-US`.
 */
export class Migration20261003T115043LanguagesRepairDefaultChannelLanguage extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "sales_channels"
          set "languages" = '["en-US"]'::jsonb,
              "default_language" = 'en-US',
              "version" = "version" + 1,
              "updated_at" = now()
        where "languages" = '["en"]'::jsonb
          and "default_language" = 'en'
          and not exists (select 1 from "languages" where "code" = 'en')
          and exists (select 1 from "languages" where "code" = 'en-US');`,
    );
  }

  override async down(): Promise<void> {
    // Deliberately empty. Reverting would put back a language code the
    // dictionary does not hold, and the rows this repaired cannot be told apart
    // from channels an operator has since configured as `en-US` on purpose.
  }
}
