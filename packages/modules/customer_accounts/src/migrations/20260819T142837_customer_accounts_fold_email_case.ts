import { Migration } from '@mikro-orm/migrations';

/**
 * Fold `customer_accounts.email` to the form the code now stores and compares.
 *
 * The writes folded the address and the login read did not, so a buyer who
 * registered as `Jan.Kowalski@example.pl` could never sign in: Postgres' `=` on
 * `text` is case-sensitive and the row said `jan.kowalski@example.pl`. The code
 * side of the repair makes every read and every write go through
 * `normalizeEmailAddress`; this migration brings the rows written before it to
 * the same form, so an address stored mixed-case stays reachable.
 *
 * ## What a collision means, and why it does not fail the deploy
 *
 * Two rows differing only in case are two accounts that the fold turns into one
 * address, and `customer_accounts_email_unique` will not hold both. The
 * migration therefore **folds one row per address and leaves the rest exactly as
 * they are** — it drops nothing, merges nothing and refuses nothing:
 *
 *  - a row that **already holds the folded address** wins it, because it is the
 *    one every other table's foreign keys have been resolving to by that
 *    address all along;
 *  - otherwise the **earliest-created** row wins it, since it is the account
 *    with the longer history of orders, invoices and addresses behind it;
 *  - every other row in the group keeps its stored spelling and is counted by
 *    the warning below.
 *
 * A stranded row is not data loss but it is not a working account either: the
 * login read folds, so nothing will match its spelling until an operator merges
 * or renames it. That is a decision about somebody's orders, and a migration
 * running unattended must not take it. The alternative — failing the deploy —
 * would stop every other repair in the same release over a pair of rows that a
 * human has to look at anyway.
 *
 * ## Measured before it was written
 *
 * Zero collisions and zero mixed-case rows across both developer databases
 * (`b2b`: 1 account; `b2b_test`: 3), which is what the two-developer-environment
 * / no-production state of the platform predicts. The rules above are therefore
 * written for the environments this will meet later, not for a pair of rows
 * anybody has today.
 */
export class Migration20260819T142837CustomerAccountsFoldEmailCase extends Migration {
  override async up(): Promise<void> {
    // One winner per folded address: a row that already holds it first
    // (`email = folded` sorts true-first under `desc`), then the earliest
    // created, then the smallest id so the choice is deterministic. The winner
    // is only updated when it does not already hold the folded value, which is
    // also why this statement cannot violate the unique index: an update
    // happens only for a group in which no row holds the target address.
    this.addSql(`
      with ranked as (
        select "id",
               lower(btrim("email")) as folded,
               row_number() over (
                 partition by lower(btrim("email"))
                 order by ("email" = lower(btrim("email"))) desc,
                          "created_at" asc,
                          "id" asc
               ) as rank
          from "customer_accounts"
      )
      update "customer_accounts" ca
         set "email" = r.folded
        from ranked r
       where r."id" = ca."id"
         and r.rank = 1
         and ca."email" <> r.folded;
    `);

    // Say out loud what was left behind. A migration that quietly leaves an
    // account nobody can log into is the same class of defect as the one being
    // repaired here.
    this.addSql(`
      do $$
      declare
        stranded integer;
      begin
        select count(*) into stranded
          from "customer_accounts"
         where "email" <> lower(btrim("email"));
        if stranded > 0 then
          raise warning
            'customer_accounts: % row(s) kept a mixed-case e-mail because another account already holds the folded address. They cannot be signed into until an operator merges or renames them.',
            stranded;
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    // Deliberately empty. The original capitalisation is not recorded anywhere
    // — this migration overwrites the only copy of it — so there is nothing to
    // restore, and an `up` that folded a handful of rows must not be paired
    // with a `down` that pretends otherwise. Rolling this back means rolling
    // back the code that reads the folded form; the rows are then already in
    // the shape the old code wrote, which is what it was folding to anyway.
  }
}
