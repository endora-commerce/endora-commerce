import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/177-tax-id-scope/` FR-021 — writers of one tax ID take turns.
 *
 * Every insert into `organizations` ends its statement by taking the reach
 * governor's one advisory lock (`organizations_reach_governor`, held to
 * commit), and the `per-tree-root` exclusion constraint is checked at commit.
 * Two transactions writing one tax ID therefore deadlocked: the first, holding
 * the governor's lock, waits at its commit for the second's row; the second,
 * whose row exists, waits for the governor's lock. PostgreSQL broke the cycle
 * by aborting one with `40P01`, which reached the client as a 500 where the
 * loser of the race must get a 409.
 *
 * A `before insert or update of tax_id, path` row trigger takes a
 * transaction-scoped advisory lock keyed on the tax ID **before the row is
 * written**, so the second writer of a tax ID waits for the first to commit or
 * roll back and then meets its committed row: the constraint's refusal (or the
 * pre-check's) instead of a deadlock. `path` is in the list because a move
 * changes the generated `root_id` — and takes the governor's lock — without
 * touching `tax_id` (D-290 / OD-10).
 *
 * **Lock order, the invariant every writer keeps:** tax-ID locks before the
 * reach governor's, and tax-ID locks in ascending order. A single-row write
 * takes one; the tree Command, which rewrites a subtree holding several, takes
 * them all in ascending order before its path rewrite
 * (`OrganizationTreeService.lockSubtreeTaxIds`), so the trigger's per-row
 * re-acquisitions are re-entrant no-ops. A hash collision only makes two
 * writers of different tax IDs wait for each other. Writers of different tax IDs do not wait for each other here. In
 * `global` the unique index already serialises them; the lock costs nothing
 * there and keeps one rule for both scopes.
 *
 * Every object is this module's own. Repeatable: `create or replace`, and the
 * trigger dropped before it is created.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261110T173752OrganizationsTaxIdWriteLock extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function "organizations_tax_id_write_lock"()
      returns trigger language plpgsql as $$
      begin
        if new."tax_id" is not null then
          perform pg_advisory_xact_lock(hashtextextended('organizations.tax_id:' || new."tax_id", 0));
        end if;
        return new;
      end
      $$;
    `);
    this.addSql(`drop trigger if exists "organizations_tax_id_write_lock" on "organizations";`);
    this.addSql(`
      create trigger "organizations_tax_id_write_lock"
        before insert or update of "tax_id", "path" on "organizations"
        for each row execute function "organizations_tax_id_write_lock"();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists "organizations_tax_id_write_lock" on "organizations";`);
    this.addSql(`drop function if exists "organizations_tax_id_write_lock"();`);
  }
}
