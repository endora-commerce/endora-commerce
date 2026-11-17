import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Issue #956 — the organization tree as the harness writes and checks it.
 *
 * `organizations.path` is `'/<rootId>/…/<thisId>/'`: a root's is `'/<id>/'`, a
 * child's is its parent's followed by `'<id>/'`. The entity's create hook writes
 * a root's; a child's is the tree Commands' to compute, so a fixture that
 * inserts a child writes it itself — **with the insert**, not patched in by a
 * second flush. The reach-governor triggers (migration `20261109T144721`) run on
 * the insert and read the path as it was then.
 */
export function organizationTreePath(id: string, parent?: { path: string } | null): string {
  return parent ? `${parent.path}${id}/` : `/${id}/`;
}

/**
 * Every organization whose stored `path` differs from the one its `parent_id`
 * chain implies — the walk the repair migration `20261003T184802` makes, read
 * rather than written. A row on no chain from a root (a cycle in `parent_id`)
 * is reported with `expected: null`. Empty on a well-seeded database.
 */
export async function organizationsOffTheirTree(
  em: EntityManager,
): Promise<Array<{ id: string; path: string; expected: string | null }>> {
  return (await em.getConnection().execute(
    `with recursive "tree" ("id", "path") as (
       select o."id", '/' || o."id"::text || '/'
         from "organizations" o
        where o."parent_id" is null
       union all
       select c."id", t."path" || c."id"::text || '/'
         from "organizations" c
         join "tree" t on c."parent_id" = t."id"
     )
     select o."id"::text as "id", o."path", t."path" as "expected"
       from "organizations" o
       left join "tree" t on t."id" = o."id"
      where t."path" is distinct from o."path"
         or not "organizations_tree_path_readable"(o."path", o."id")
      order by o."id"`,
  )) as Array<{ id: string; path: string; expected: string | null }>;
}

/**
 * How many rows of the maintained `organization_reach_governor` table differ
 * from a rebuild from scratch (`organizations_reach_governor_rebuild(null)`),
 * in either direction. Read in a transaction that is rolled back, so the table
 * is left as it was. Zero when every write kept it current.
 */
export async function staleReachGovernorRows(em: EntityManager): Promise<number> {
  const sentinel = new Error('rollback');
  let stale = -1;
  await em
    .fork()
    .transactional(async (tx) => {
      await tx.execute('create temporary table "harness_reach_governor_maintained" on commit drop as select * from "organization_reach_governor"');
      await tx.execute('select "organizations_reach_governor_rebuild"(null)');
      const rows = await tx.execute<Array<{ n: string }>>(
        `select count(*)::text as "n" from (
           (select * from "harness_reach_governor_maintained" except select * from "organization_reach_governor")
           union all
           (select * from "organization_reach_governor" except select * from "harness_reach_governor_maintained")
         ) d`,
      );
      stale = Number(rows[0]!.n);
      throw sentinel;
    })
    .catch((error: unknown) => {
      if (error !== sentinel) throw error;
    });
  return stale;
}
