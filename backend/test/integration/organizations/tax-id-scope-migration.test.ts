import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261110T135941OrganizationsTaxIdScope } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `specs/177-tax-id-scope/` T004 — migration M2, executed rather than described
 * (data-model §1–§3).
 *
 * M2 adds the stored generated `root_id`, the single-row
 * `organization_tax_id_policy` seeded `global`, and `btree_gist`. It does **not**
 * add the exclusion constraint: a fresh and an upgraded database both start in
 * `global`, and only the scope Command installs it — migrations never depend on
 * the scope. Its `down()` refuses while the policy says `per-tree-root`.
 *
 * Everything runs in a transaction that is rolled back; a statement expected to
 * fail runs under a savepoint.
 */
describe('organizations — M2: the tax-ID scope foundation', () => {
  let db: TestDb;
  let em: EntityManager;

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261110T135941OrganizationsTaxIdScope(em.getDriver(), em.config);
    await migration[direction]();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
  }

  async function insertOrganization(path: (id: string) => string, parentId: string | null = null): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","parent_id","path","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, ?, now(), now())`,
      [id, `M2 ${id.slice(0, 8)}`, `M2${id.replace(/-/g, '').slice(0, 20)}`, parentId, path(id)],
    );
    return id;
  }

  async function rootOf(id: string): Promise<string | null> {
    const rows = (await em.execute('select "root_id" from "organizations" where "id" = ?', [id])) as Array<{
      root_id: string | null;
    }>;
    return rows[0]!.root_id;
  }

  async function scope(): Promise<string> {
    const rows = (await em.execute('select "scope" from "organization_tax_id_policy"')) as Array<{ scope: string }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.scope;
  }

  async function constraintNames(): Promise<string[]> {
    const rows = (await em.execute(
      `select conname from pg_constraint
        where conrelid = 'organizations'::regclass
          and conname in ('organizations_tax_id_unique', 'organizations_tax_id_one_tree')
        order by conname`,
    )) as Array<{ conname: string }>;
    return rows.map((r) => r.conname);
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('root_id is the first path segment, for a root and for its descendants', async () => {
    const root = await insertOrganization((id) => `/${id}/`);
    const child = await insertOrganization((id) => `/${root}/${id}/`, root);
    const grandchild = await insertOrganization((id) => `/${root}/${child}/${id}/`, child);
    expect(await rootOf(root)).toBe(root);
    expect(await rootOf(child)).toBe(root);
    expect(await rootOf(grandchild)).toBe(root);
  });

  it('root_id follows a re-parent of a whole subtree', async () => {
    const oldRoot = await insertOrganization((id) => `/${id}/`);
    const newRoot = await insertOrganization((id) => `/${id}/`);
    const child = await insertOrganization((id) => `/${oldRoot}/${id}/`, oldRoot);
    const grandchild = await insertOrganization((id) => `/${oldRoot}/${child}/${id}/`, child);

    // The tree service's one-statement subtree rewrite (`applyReparentPaths`).
    await em.execute(
      `update "organizations" set "path" = ? || substr("path", length(?) + 1) where "path" like ? || '%'`,
      [`/${newRoot}/${child}/`, `/${oldRoot}/${child}/`, `/${oldRoot}/${child}/`],
    );

    expect(await rootOf(child)).toBe(newRoot);
    expect(await rootOf(grandchild)).toBe(newRoot);
    expect(await rootOf(oldRoot)).toBe(oldRoot);
  });

  it('root_id is null for an empty path rather than failing the cast', async () => {
    const empty = await insertOrganization(() => '');
    expect(await rootOf(empty)).toBeNull();
  });

  it('seeds the policy row global and installs no exclusion constraint', async () => {
    // The template may have been switched by the suite's scope matrix (WP-3);
    // what M2 itself leaves is read on a fresh run of it.
    if ((await scope()) !== 'global') return;
    await run('down');
    await run('up');
    expect(await scope()).toBe('global');
    expect(await constraintNames()).toEqual(['organizations_tax_id_unique']);
    const [policy] = (await em.execute(
      'select "id", "updated_by_admin_user_id" from "organization_tax_id_policy"',
    )) as Array<{ id: boolean; updated_by_admin_user_id: string | null }>;
    expect(policy).toEqual({ id: true, updated_by_admin_user_id: null });
  });

  it('the policy table holds one row and only the two scopes', async () => {
    for (const sql of [
      `insert into "organization_tax_id_policy" ("id", "scope") values (false, 'global')`,
      `update "organization_tax_id_policy" set "scope" = 'none'`,
    ]) {
      await em.execute('savepoint m2_policy');
      await expect(em.execute(sql)).rejects.toThrow();
      await em.execute('rollback to savepoint m2_policy');
    }
  });

  it('btree_gist is present', async () => {
    const rows = (await em.execute(`select 1 from pg_extension where extname = 'btree_gist'`)) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it('down() refuses while the policy says per-tree-root, and changes nothing', async () => {
    await em.execute(`update "organization_tax_id_policy" set "scope" = 'per-tree-root'`);
    await em.execute('savepoint m2_down');
    await expect(run('down')).rejects.toThrow(/per-tree-root/);
    await em.execute('rollback to savepoint m2_down');
    expect(await scope()).toBe('per-tree-root');
    const root = await insertOrganization((id) => `/${id}/`);
    expect(await rootOf(root)).toBe(root);
  });

  it('down() in global removes the table and root_id; up() brings them back', async () => {
    if ((await scope()) !== 'global') return;
    await run('down');
    const [{ table, column }] = (await em.execute(
      `select to_regclass('organization_tax_id_policy') is not null as "table",
              exists (select 1 from information_schema.columns
                       where table_name = 'organizations' and column_name = 'root_id') as "column"`,
    )) as Array<{ table: boolean; column: boolean }>;
    expect({ table, column }).toEqual({ table: false, column: false });

    await run('up');
    await run('up'); // repeatable
    expect(await scope()).toBe('global');
    const root = await insertOrganization((id) => `/${id}/`);
    expect(await rootOf(root)).toBe(root);
  });
});
