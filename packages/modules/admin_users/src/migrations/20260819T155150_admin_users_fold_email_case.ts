import { Migration } from '@mikro-orm/migrations';

/**
 * Fold `admin_users.email` to the form the code now stores and compares.
 *
 * `AdminUserService.create` folded the address and the login read compared it
 * verbatim, so an operator created as `Anna.Nowak@endora.pl` had
 * `anna.nowak@endora.pl` on record and could never sign in with the address
 * they were handed: Postgres' `=` on `text` is case-sensitive. The code side of
 * the repair makes every read and every write go through
 * `normalizeEmailAddress`; this migration brings the rows written before it to
 * the same form, so an address stored mixed-case stays reachable.
 *
 * The policy is the one the buyer-side twin of this defect settled on
 * (`20260819T142837_customer_accounts_fold_email_case.ts`), and it is repeated
 * rather than re-decided.
 *
 * ## What a collision means, and why it does not fail the deploy
 *
 * Two rows differing only in case are two operators that the fold turns into
 * one address, and `admin_users_email_unique` will not hold both. The migration
 * therefore **folds one row per address and leaves the rest exactly as they
 * are** — it drops nothing, merges nothing and refuses nothing:
 *
 *  - a row that **already holds the folded address** wins it, because it is the
 *    one every audit row, every assignment and every session has been resolving
 *    to by that address all along;
 *  - otherwise the **earliest-created** row wins it, since it is the operator
 *    with the longer history behind it;
 *  - every other row in the group keeps its stored spelling and is counted by
 *    the warning below.
 *
 * A stranded row is not data loss but it is not a working operator either: the
 * login read folds, so nothing will match its spelling until an operator
 * renames it. Which admin account somebody's audit trail belongs to is not a
 * decision a migration running unattended may take, and failing the deploy
 * would stop every other repair in the same release over a pair of rows a human
 * has to look at anyway.
 *
 * The admin side has one aggravating circumstance the buyer side does not: it
 * ships no e-mail-keyed password reset, so a stranded operator has no
 * self-service way back in at all. That is what the warning is for — it names a
 * row somebody has to go and fix.
 *
 * ## Measured before it was written
 *
 * Zero collisions and zero mixed-case rows across both developer databases
 * (`b2b`: 3 admin users; `b2b_test`: 4). The rules above are therefore written
 * for the environments this will meet later, not for a pair of rows anybody has
 * today.
 */
export class Migration20260819T155150AdminUsersFoldEmailCase extends Migration {
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
          from "admin_users"
      )
      update "admin_users" au
         set "email" = r.folded
        from ranked r
       where r."id" = au."id"
         and r.rank = 1
         and au."email" <> r.folded;
    `);

    // Say out loud what was left behind. A migration that quietly leaves an
    // operator nobody can sign in as is the same class of defect as the one
    // being repaired here.
    this.addSql(`
      do $$
      declare
        stranded integer;
      begin
        select count(*) into stranded
          from "admin_users"
         where "email" <> lower(btrim("email"));
        if stranded > 0 then
          raise warning
            'admin_users: % row(s) kept a mixed-case e-mail because another admin user already holds the folded address. They cannot be signed into until an operator renames them.',
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
