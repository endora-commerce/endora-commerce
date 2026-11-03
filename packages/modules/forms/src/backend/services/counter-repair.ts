import type { CommandContext } from '@endora-commerce/platform/commands';

/**
 * Counter repair (`specs/170-forms-module/` research R-20, Principle XI review): each form's
 * `accepted_entry_count` — the non-spam entries across every organisation, which the maximum-
 * entries rule reads — recomputed from the entries it counts and written where it drifted.
 *
 * The Commands that change entries keep the counter in step in their own transaction; this pass is
 * the backstop for whatever escaped them (a crash between statements, a hand-edited row). It is a
 * derived value set back to what the rows already say, not a domain change, so it writes no audit
 * row of its own — the system scope it runs in records the escape-hatch entry. One statement, so a
 * concurrent submit is never half-counted.
 */

type Em = CommandContext['em'];

export class CounterRepair {
  constructor(private readonly emFactory: () => Em) {}

  /** Whether any form exists to count — a global read, outside any scope. */
  async hasWork(): Promise<boolean> {
    const rows = (await this.emFactory()
      .getConnection()
      .execute(`select exists (select 1 from "forms") as "any"`)) as Array<{ any: boolean }>;
    return rows[0]?.any === true;
  }

  /** Recompute every drifted counter. Answers how many forms were corrected. Runs in the system scope. */
  async run(): Promise<number> {
    const rows = (await this.emFactory()
      .getConnection()
      .execute(
        `update "forms" as "f" set "accepted_entry_count" = "c"."n"
           from (
             select "f2"."id", count("e"."id") filter (where "e"."status" <> 'spam')::int as "n"
               from "forms" as "f2"
               left join "form_entries" as "e" on "e"."form_id" = "f2"."id"
              group by "f2"."id"
           ) as "c"
          where "c"."id" = "f"."id" and "f"."accepted_entry_count" <> "c"."n"
        returning "f"."id"`,
      )) as Array<{ id: string }>;
    return rows.length;
  }
}
