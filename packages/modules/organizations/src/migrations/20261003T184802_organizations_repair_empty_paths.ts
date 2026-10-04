import { Migration } from '@mikro-orm/migrations';

/**
 * Rewrites every organization's materialized `path` from its `parent_id` chain,
 * which repairs the rows created with an empty one.
 *
 * ## The defect
 *
 * `organizations.path` is `'/<rootId>/…/<thisId>/'`, and the hierarchy migration
 * backfilled it to `'/<id>/'` for the rows that existed on the day it ran. After
 * that only the re-parent Command wrote it. Nothing that *creates* an
 * organization did — not company registration, not the personal organization a
 * B2C account gets, not the demo seed — so each of those rows kept the column's
 * `''` default.
 *
 * The tree reads a path as a prefix, and `''` is the prefix of everything:
 *
 *  - `subtreeIds` is `path like <own path> || '%'`, so the subtree of such an
 *    organization was **every** organization;
 *  - the cycle rule is `newParent.path.startsWith(node.path)`, so re-parenting
 *    such an organization under anything refused as a cycle;
 *  - and re-parenting a well-formed organization *under* one built the child's
 *    path from the parent's empty one, leaving `'<id>/'` with no leading slash.
 *
 * The entity now assigns the root path on create. This migration reaches the
 * rows written before that.
 *
 * ## Exactly which rows
 *
 * Every row whose `path` differs from the one its `parent_id` chain implies:
 * a root is `'/<id>/'`, a child is its parent's path followed by `'<id>/'`.
 * `parent_id` is the authoritative edge — it carries the foreign key, and
 * `path` is by definition its materialization — so the walk starts at the rows
 * with no parent and descends. That covers all three shapes above in one
 * statement, where filling only the empty roots would have left the children
 * hung under them wrong.
 *
 * A well-formed row is not written at all (`is distinct from`), so on a tree
 * nobody damaged — and on a fresh database, which holds no organization yet —
 * this is a no-op, and a second run matches nothing.
 *
 * Each repaired row gets its `version` bumped by one and `updated_at` set, so
 * an admin form still holding the old version is refused rather than writing
 * over a row this changed underneath it.
 *
 * ## Why no `check ("path" <> '')`
 *
 * The constraint was considered and left out. The column's default is `''`,
 * and an `insert` that names no `path` is how other statements already create
 * organizations — `customer_accounts`' migration that provisions a personal
 * organization per account is one, and it is ordered *after* this module's
 * migrations on an instance that has yet to run it. A constraint here would
 * turn that insert into a failed upgrade. What protects the tree instead is
 * that every reader in `OrganizationTreeService` judges a path before using it
 * as a prefix (`isReadableTreePath`).
 */
export class Migration20261003T184802OrganizationsRepairEmptyPaths extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `with recursive "tree" ("id", "path") as (
         select o."id", '/' || o."id"::text || '/'
           from "organizations" o
          where o."parent_id" is null
         union all
         select c."id", t."path" || c."id"::text || '/'
           from "organizations" c
           join "tree" t on c."parent_id" = t."id"
       )
       update "organizations" o
          set "path" = t."path",
              "version" = o."version" + 1,
              "updated_at" = now()
         from "tree" t
        where o."id" = t."id"
          and o."path" is distinct from t."path";`,
    );
  }

  override async down(): Promise<void> {
    // Deliberately empty. Reverting would put back paths the tree service
    // misreads, and a repaired row cannot be told apart from one that was
    // always well-formed.
  }
}
