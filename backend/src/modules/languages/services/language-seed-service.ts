import type { LanguageSeedPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The seeding face of `languages` (feature 077, D-87 drain).
 *
 * One job: fill the empty `native_label` that migration 038 left behind on the
 * two languages migration 012 created. `dictionaries` knows the labels — it
 * ships the reference catalogue — and this module owns the table, so before
 * this port the reconciler wrote it with an `update "languages" …` naming
 * another module's table in a string no import-level check can see.
 *
 * The `and "native_label" = ''` predicate is the idempotency: once an operator
 * (or an earlier boot) has set a label, a re-run matches no row and reverts
 * nothing.
 */
export class LanguageSeedService implements LanguageSeedPort {
  constructor(private readonly emFactory: () => EntityManager) {}

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
