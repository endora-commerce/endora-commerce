import type { LanguageSeedPort, LanguageSeedRow } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The seeding face of `languages` (feature 077, D-87 drain).
 *
 * Two jobs, and `dictionaries` is the caller of both: it ships the reference
 * catalogue, and this module owns the table.
 *
 * **`ensureSeeded`** inserts the catalogue languages whose code is missing.
 * Every row it inserts is `is_active = false` and `is_default = false`, written
 * as literals in the statement rather than read from the row: the active set is
 * what a storefront offers, what `catalog` resolves a translation chain over
 * and what `product_feeds` emits, so a language becomes active by an operator's
 * decision and by nothing a data file can carry. The two languages the init
 * migration created are untouched — they exist, so they are skipped.
 *
 * **`backfillNativeLabels`** fills the empty `native_label` that migration 038
 * left behind on those two. Before this port the reconciler wrote it with an
 * `update "languages" …` naming another module's table in a string no
 * import-level check can see. The `and "native_label" = ''` predicate is the
 * idempotency: once an operator (or an earlier boot) has set a label, a re-run
 * matches no row and reverts nothing.
 *
 * Raw SQL on **this module's own** table, deliberately, and the same shape
 * `CurrencySeedService` uses: a boot seed that went through the admin write path
 * would record one audit row per language for something no operator did.
 */
export class LanguageSeedService implements LanguageSeedPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async ensureSeeded(rows: readonly LanguageSeedRow[]): Promise<number> {
    const em = this.emFactory();
    const existing = (await em.execute('select "code" from "languages"')) as Array<{
      code: string;
    }>;
    const present = new Set(existing.map((row) => row.code));

    const missing: LanguageSeedRow[] = [];
    for (const row of rows) {
      if (present.has(row.code)) continue;
      present.add(row.code);
      missing.push(row);
    }
    if (missing.length === 0) return 0;

    // One statement for the whole catalogue, and `on conflict do nothing` on
    // top of the filter above. The filter is what keeps a settled boot to a
    // single `select`; the conflict clause is what makes two backends booting
    // side by side safe — both read "missing", both insert, and without it the
    // slower one dies on the primary key at the moment a deployment is rolling
    // out. `returning` counts what this call inserted, not what it proposed.
    //
    // The rows travel as one JSON parameter rather than as a generated list of
    // placeholders, so the statement stays a literal: `check:command-coverage`
    // reads SQL as text, and a write assembled by interpolation is a write it
    // cannot see.
    //
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // owned insert of shipped reference data with no actor behind it. It runs
    // at boot, inserts only codes that are absent and never touches a row an
    // operator has edited, so there is nothing to audit and nothing to undo.
    const inserted = (await em.execute(
      `insert into "languages"
         ("code","label","native_label","is_rtl",
          "is_default","is_active","sort_order","created_at","updated_at")
       select t."code", t."label", t."nativeLabel", t."isRtl",
              false, false, t."sortOrder", now(), now()
         from jsonb_to_recordset(?::jsonb)
           as t("code" text, "label" text, "nativeLabel" text, "isRtl" boolean, "sortOrder" int)
       on conflict ("code") do nothing
       returning "code"`,
      [
        JSON.stringify(
          missing.map((row) => ({
            code: row.code,
            label: row.label,
            nativeLabel: row.nativeLabel,
            isRtl: row.isRtl ?? false,
            sortOrder: row.sortOrder ?? 0,
          })),
        ),
      ],
    )) as Array<{ code: string }>;
    return inserted.length;
  }

  async backfillNativeLabels(
    rows: readonly { code: string; nativeLabel: string }[],
  ): Promise<number> {
    const em = this.emFactory();
    let filled = 0;
    for (const row of rows) {
      const before = (await em.execute('select "native_label" from "languages" where "code" = ?', [
        row.code,
      ])) as Array<{ native_label: string }>;
      if (before.length === 0) continue;
      if (before[0]?.native_label !== '') continue;
      // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
      // owned backfill of a column the migration left empty, with no actor behind
      // it. The `= ''` predicate means it can only ever fill a blank, never
      // overwrite an operator's label, so there is nothing to audit or undo.
      await em.execute(
        `update "languages" set "native_label" = ? where "code" = ? and "native_label" = ''`,
        [row.nativeLabel, row.code],
      );
      filled += 1;
    }
    return filled;
  }
}
