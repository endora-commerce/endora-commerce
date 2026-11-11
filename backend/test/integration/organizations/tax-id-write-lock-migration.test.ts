import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261110T173752OrganizationsTaxIdWriteLock } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * `specs/177-tax-id-scope/` FR-021 — the tax-ID write lock, a `before insert or
 * update of tax_id` row trigger taking a transaction-scoped advisory lock keyed
 * on the tax ID.
 *
 * Why it exists is in `tax-id-conflict-concurrency.test.ts`: every
 * organization insert takes the reach governor's one advisory lock at the end
 * of its statement, and `per-tree-root`'s exclusion constraint is checked at
 * commit — so two writers of one tax ID deadlocked (`40P01`, a 500) instead of
 * one of them losing with a 409. Serialising the writers of one tax ID before
 * either has a row removes the cycle. Here: the migration installs and removes
 * exactly that, and is repeatable.
 */
describe('organizations — the tax-ID write lock', () => {
  let db: TestDb;
  let em: EntityManager;

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261110T173752OrganizationsTaxIdWriteLock(em.getDriver(), em.config);
    await migration[direction]();
    for (const query of migration.getQueries()) await em.execute(query as string);
  }

  async function trigger(): Promise<Array<{ tgname: string; definition: string }>> {
    return (await em.execute(
      `select tgname, pg_get_triggerdef(oid) as "definition" from pg_trigger
        where tgrelid = 'organizations'::regclass and tgname = 'organizations_tax_id_write_lock'`,
    )) as Array<{ tgname: string; definition: string }>;
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

  it('is installed by the migration chain: before insert or update of tax_id or path, for each row', async () => {
    const [row] = await trigger();
    expect(row?.definition).toMatch(/BEFORE INSERT OR UPDATE OF tax_id, path ON public\.organizations FOR EACH ROW/);
  });

  it('down() removes the trigger and its function; up() puts them back, twice over', async () => {
    await run('down');
    expect(await trigger()).toEqual([]);
    const [fn] = (await em.execute(
      `select count(*)::int as "count" from pg_proc where proname = 'organizations_tax_id_write_lock'`,
    )) as [{ count: number }];
    expect(fn.count).toBe(0);
    await run('up');
    await run('up');
    expect(await trigger()).toHaveLength(1);
  });

  it('takes the advisory lock of the tax ID\'s bucket', async () => {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       values (?, 'Write lock', 'WL177LOCKED01', 'active', 'vat_payer', false, '{}'::jsonb, ?, now(), now())`,
      [id, `/${id}/`],
    );
    const [held] = (await em.execute(
      `select count(*)::int as "count" from pg_locks
        where locktype = 'advisory' and pid = pg_backend_pid()
          and classid = 177 and objid = (hashtext('WL177LOCKED01') & 255)`,
    )) as [{ count: number }];
    expect(held.count).toBe(1);
  });

  async function heldAdvisoryLocks(): Promise<number> {
    const [row] = (await em.execute(
      `select count(*)::int as "count" from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
    )) as [{ count: number }];
    return row.count;
  }

  // Review finding 1 — the locks a transaction takes are bounded however many
  // tax IDs it writes: keyed by a bucket of the tax ID, not the tax ID itself.
  it('takes at most 256 locks however many tax IDs one transaction writes', async () => {
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       select g.id, 'Many', 'WLM' || lpad(g.n::text, 6, '0'), 'active', 'vat_payer', false, '{}'::jsonb,
              '/' || g.id || '/', now(), now()
         from (select gen_random_uuid() as id, n from generate_series(1, 600) as n) g`,
    );
    expect(await heldAdvisoryLocks()).toBeLessThanOrEqual(256);
  });

  it('a move locks a large subtree in at most 256 locks', async () => {
    const root = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       values (?, 'Big root', 'WLROOT0001', 'active', 'vat_payer', false, '{}'::jsonb, ?, now(), now())`,
      [root, `/${root}/`],
    );
    await em.execute('alter table "organizations" disable trigger user');
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at")
       select g.id, 'Big child', 'WLS' || lpad(g.n::text, 6, '0'), 'active', 'vat_payer', false, '{}'::jsonb, ?,
              ? || g.id || '/', now(), now()
         from (select gen_random_uuid() as id, n from generate_series(1, 600) as n) g`,
      [root, `/${root}/`],
    );
    await em.execute('alter table "organizations" enable trigger user');
    const before = await heldAdvisoryLocks();
    await new OrganizationTreeService(() => em).lockSubtreeTaxIds(em, { id: root, path: `/${root}/` } as never);
    expect((await heldAdvisoryLocks()) - before).toBeLessThanOrEqual(256);
  });
});
