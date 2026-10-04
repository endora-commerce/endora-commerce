import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261003T184802OrganizationsRepairEmptyPaths } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * The repair for organizations stored with an empty materialized `path`,
 * executed rather than described.
 *
 * Until the entity assigned a root path on create, every organization that was
 * created and never re-parented kept `path = ''` — the prefix of every path.
 * This migration is what reaches those rows on an existing instance.
 *
 * The statements come from the migration class, not from a copy of them here,
 * and the rows are written in raw SQL because the point is a row in a state the
 * code can no longer produce. Everything runs inside a transaction that is
 * rolled back.
 */
describe('organizations — repairing rows stored with an empty path', () => {
  let db: TestDb;
  let em: EntityManager;

  async function runMigration(): Promise<void> {
    const migration = new Migration20261003T184802OrganizationsRepairEmptyPaths(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
  }

  async function insertOrganization(path: string, parentId: string | null = null): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","parent_id","path","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, ?, now(), now())`,
      [id, `Repair ${id.slice(0, 8)}`, `repair-${id.slice(0, 13)}`, parentId, path],
    );
    return id;
  }

  async function row(id: string): Promise<{ path: string; version: number; updated_at: string }> {
    const rows = (await em.execute(
      'select "path", "version", "updated_at"::text as "updated_at" from "organizations" where "id" = ?',
      [id],
    )) as Array<{ path: string; version: number; updated_at: string }>;
    expect(rows).toHaveLength(1);
    return rows[0]!;
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

  it('gives an empty-path root the path of a root', async () => {
    const a = await insertOrganization('');
    const b = await insertOrganization('');

    const versionBefore = (await row(a)).version;

    await runMigration();

    expect((await row(a)).path).toBe(`/${a}/`);
    expect((await row(b)).path).toBe(`/${b}/`);
    // Bumped, so a form holding the old version is refused instead of writing
    // over the repaired row.
    expect((await row(a)).version).toBe(versionBefore + 1);
  });

  it('rebuilds the subtree that was hung under an empty-path parent', async () => {
    // What the re-parent Command wrote when the new parent's path was empty:
    // the child's path built from `''`, so with no leading slash, and its own
    // descendant rewritten under that.
    const parent = await insertOrganization('');
    const child = await insertOrganization('', parent);
    await em.execute('update "organizations" set "path" = ? where "id" = ?', [`${child}/`, child]);
    const grandchild = await insertOrganization('', child);
    await em.execute('update "organizations" set "path" = ? where "id" = ?', [
      `${child}/${grandchild}/`,
      grandchild,
    ]);

    await runMigration();

    expect((await row(parent)).path).toBe(`/${parent}/`);
    expect((await row(child)).path).toBe(`/${parent}/${child}/`);
    expect((await row(grandchild)).path).toBe(`/${parent}/${child}/${grandchild}/`);
  });

  it('does not write a row whose path is already right', async () => {
    const rootId = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","parent_id","path","created_at","updated_at")
       values (?, 'Well-formed root', ?, 'active', 'vat_payer', '{}'::jsonb, null, ?, now(), now())`,
      [rootId, `repair-ok-${rootId.slice(0, 8)}`, `/${rootId}/`],
    );
    const child = await insertOrganization('', rootId);
    await em.execute('update "organizations" set "path" = ? where "id" = ?', [
      `/${rootId}/${child}/`,
      child,
    ]);
    const before = [await row(rootId), await row(child)];

    await runMigration();

    expect([await row(rootId), await row(child)]).toEqual(before);
  });

  it('matches nothing on a second run', async () => {
    const a = await insertOrganization('');
    await runMigration();
    const after = await row(a);

    const migration = new Migration20261003T184802OrganizationsRepairEmptyPaths(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    let changed = 0;
    for (const query of migration.getQueries()) {
      const result = (await em.getConnection().execute(
        query as string,
        [],
        'run',
        em.getTransactionContext(),
      )) as { affectedRows: number };
      changed += result.affectedRows;
    }

    expect(changed).toBe(0);
    expect(await row(a)).toEqual(after);
  });
});
