import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261110T183238OrganizationsTaxIdNormalise } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { TaxIdScopeService } from '../../../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js';

/**
 * `specs/177-tax-id-scope/` T041d (D-290 / OD-11) — tax IDs are stored
 * normalised: M4 rewrites every row to the canonical form (whitespace and
 * dashes removed, upper-cased) and adds `organizations_tax_id_normalised`, which
 * refuses anything else from any writer. Two rows that normalise to one tax ID
 * where the scope forbids sharing it — anywhere in `global`, across trees in
 * `per-tree-root` — make M4 refuse, naming them: which organization keeps the
 * tax ID is the operator's call.
 *
 * Each test runs M4's `down()` first, inside a rolled-back transaction, so the
 * table is in the pre-M4 shape.
 */
describe('organizations — M4: tax IDs stored normalised', () => {
  let db: TestDb;
  let em: EntityManager;

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261110T183238OrganizationsTaxIdNormalise(em.getDriver(), em.config);
    await migration[direction]();
    for (const query of migration.getQueries()) await em.execute(query as string);
  }

  async function upError(): Promise<string | undefined> {
    await em.execute('savepoint m4');
    try {
      await run('up');
    } catch (err) {
      await em.execute('rollback to savepoint m4');
      return (err as Error).message;
    }
    await em.execute('release savepoint m4');
    return undefined;
  }

  async function insert(taxId: string, parent?: { id: string; path: string }): Promise<{ id: string; path: string }> {
    const id = randomUUID();
    const path = `${parent?.path ?? '/'}${id}/`;
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","parent_id","path","created_at","updated_at")
       values (?, 'M4', ?, 'active', 'vat_payer', false, '{}'::jsonb, ?, ?, now(), now())`,
      [id, taxId, parent?.id ?? null, path],
    );
    return { id, path };
  }

  async function taxIdOf(id: string): Promise<string> {
    const [row] = (await em.execute('select "tax_id" from "organizations" where "id" = ?', [id])) as [{ tax_id: string }];
    return row.tax_id;
  }

  const stamp = (): string => randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    em = await db.beginTx();
    await run('down');
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  it('rewrites every tax ID to the canonical form and is repeatable', async () => {
    const digits = stamp();
    const spaced = await insert(` pl ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)} `.trim());
    const plain = await insert(`DE${stamp()}`);
    const plainBefore = await taxIdOf(plain.id);

    expect(await upError()).toBeUndefined();
    expect(await taxIdOf(spaced.id)).toBe(`PL${digits}`);
    expect(await taxIdOf(plain.id)).toBe(plainBefore);
    expect(await upError()).toBeUndefined();
  });

  it('then refuses an un-normalised tax ID from any writer', async () => {
    expect(await upError()).toBeUndefined();
    await em.execute('savepoint raw');
    const refused = await insert(`pl-${stamp()}`).then(
      () => undefined,
      (err: { constraint?: string }) => err.constraint,
    );
    await em.execute('rollback to savepoint raw');
    expect(refused).toBe('organizations_tax_id_normalised');
  });

  it('global: refuses, listing the organizations, when two rows normalise to one tax ID', async () => {
    if ((await new TaxIdScopeService(() => em).scope(em)) !== 'global') return;
    const digits = stamp();
    const a = await insert(`PL${digits}`);
    const b = await insert(`PL ${digits}`);

    const message = await upError();

    expect(message).toContain(`PL${digits}`);
    expect(message).toContain(a.id);
    expect(message).toContain(b.id);
    expect(await taxIdOf(b.id)).toBe(`PL ${digits}`);
  });

  it('per-tree-root: one tree may hold both spellings; two trees may not', async () => {
    const scopes = new TaxIdScopeService(() => em);
    if ((await scopes.scope(em)) !== 'per-tree-root') {
      await scopes.applyEnforcement(em, 'per-tree-root');
      await scopes.writePolicy(em, 'per-tree-root', null);
    }
    const shared = stamp();
    const root = await insert(`PL${shared}`);
    const branch = await insert(`pl-${shared}`, root);
    expect(await upError()).toBeUndefined();
    expect(await taxIdOf(branch.id)).toBe(`PL${shared}`);

    await run('down');
    const across = stamp();
    const one = await insert(`PL${across}`);
    const other = await insert(`PL ${across}`);
    const message = await upError();
    expect(message).toContain(one.id);
    expect(message).toContain(other.id);
  });

  // Review finding 1 — the update runs in the one migration transaction. With
  // the write lock keyed per tax ID that was one advisory lock per row, and a
  // few thousand rows exhausted the shared lock table (`out of shared memory`).
  it('normalises thirty thousand dash-formatted tax IDs in one transaction', async () => {
    await em.execute('alter table "organizations" disable trigger user');
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       select g.id, 'M4 bulk', 'bk-' || lpad(g.n::text, 9, '0'), 'active', 'vat_payer', false, '{}'::jsonb,
              '/' || g.id || '/', now(), now()
         from (select gen_random_uuid() as id, n from generate_series(1, 30000) as n) g`,
    );
    await em.execute('alter table "organizations" enable trigger user');

    expect(await upError()).toBeUndefined();
    const [{ left }] = (await em.execute(
      `select count(*)::int as "left" from "organizations" where "tax_id" like 'bk-%'`,
    )) as [{ left: number }];
    expect(left).toBe(0);
    const [{ held }] = (await em.execute(
      `select count(*)::int as "held" from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
    )) as [{ held: number }];
    expect(held).toBeLessThanOrEqual(256);
  }, 300_000);
});
