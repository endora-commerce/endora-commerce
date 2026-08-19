import type { CurrencySeedPort, CurrencySeedRow } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The seeding face of `currencies` (feature 077, D-87 drain).
 *
 * `dictionaries` owns the catalogue — it exists so that
 * `countries.default_currency_code` is satisfiable on a fresh install — and
 * this module owns the table. Before this port the reconciler wrote the table
 * directly, with an `insert into "currencies"` that named another module's
 * table in a string no import-level check can see.
 *
 * Raw SQL on **this module's own** table, deliberately, and the same shape
 * `blog`'s default-category seed uses: a boot seed that went through the admin
 * write path would record 53 audit rows for something no operator did.
 */
export class CurrencySeedService implements CurrencySeedPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async ensureSeeded(rows: readonly CurrencySeedRow[]): Promise<number> {
    const em = this.emFactory();
    const existing = (await em.execute('select "code" from "currencies"')) as Array<{
      code: string;
    }>;
    const present = new Set(existing.map((row) => row.code));

    let inserted = 0;
    for (const row of rows) {
      if (present.has(row.code)) continue;
      // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
      // owned insert of shipped reference data with no actor behind it. It runs
      // at boot, inserts only codes that are absent and never touches a row an
      // operator has edited, so there is nothing to audit and nothing to undo.
      await em.execute(
        `insert into "currencies"
           ("code","label","symbol","symbol_position","decimal_places",
            "is_default","is_active","sort_order","created_at","updated_at")
         values (?,?,?,?,?,false,true,0,now(),now())`,
        [row.code, row.label, row.symbol, row.symbolPosition ?? 'suffix', row.decimalPlaces ?? 2],
      );
      present.add(row.code);
      inserted += 1;
    }
    return inserted;
  }
}
