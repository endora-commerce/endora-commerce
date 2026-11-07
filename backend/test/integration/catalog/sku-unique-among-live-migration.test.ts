import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261107T091006CatalogSkuUniqueAmongLive } from '@endora-commerce/mod-catalog/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #693 — a SKU is unique among live products and variants only, and a product deleted
 * before the fix frees its variants' SKUs too.
 *
 * The migration has already run against the template. Each test re-creates what a delete made
 * before the fix leaves behind — a deleted product whose variants carry no `deleted_at` — and
 * runs the class's `up` again, which is written to be re-runnable (`if exists` / `if not exists`,
 * a back-fill that touches only unmarked variants). `down` is not run here: it restores the
 * table-wide constraints, which a database holding a reused SKU cannot take, and earlier files
 * on this worker may have left one. Everything happens in **one transaction the test rolls
 * back**, because the back-fill is table-wide (`specs/conventions/backend-test-suite.md`).
 */
describe('catalog sku_unique_among_live migration (issue #693)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function runUp(): Promise<void> {
    const m = new Migration20261107T091006CatalogSkuUniqueAmongLive(em.getDriver(), em.config);
    await m.up();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
    em.clear();
  }

  const DELETED_AT = '2026-05-06T07:08:09.000Z';

  async function insertProduct(sku: string, deletedAt: string | null): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "products" ("id", "sku", "slug", "type", "status", "deleted_at", "name", "description", "created_at", "updated_at")
       values (?, ?, ?, 'configurable', 'inactive', ?, 'I693', '', now(), now())`,
      [id, sku, `i693-${id.slice(0, 8)}`, deletedAt],
    );
    return id;
  }

  async function insertVariant(parentId: string, sku: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "product_variants" ("id", "parent_product_id", "sku", "created_at", "updated_at") values (?, ?, ?, now(), now())`,
      [id, parentId, sku],
    );
    return id;
  }

  async function variantDeletedAt(id: string): Promise<string | null> {
    const rows = (await em.execute(`select "deleted_at" from "product_variants" where "id" = ?`, [id])) as Array<{
      deleted_at: Date | string | null;
    }>;
    const value = rows[0]!.deleted_at;
    return value === null ? null : new Date(value).toISOString();
  }

  async function expectRefused(sql: string, params: unknown[], index: string): Promise<void> {
    await em.execute('savepoint i693_check');
    await expect(em.execute(sql, params)).rejects.toThrow(new RegExp(index));
    await em.execute('rollback to savepoint i693_check');
  }

  it('marks the variants of a product deleted before the fix, at the product\'s deletion time', async () => {
    const goneParent = await insertProduct('I693-MIG-GONE', DELETED_AT);
    const goneVariant = await insertVariant(goneParent, 'I693-MIG-GONE-V');
    const liveParent = await insertProduct('I693-MIG-LIVE', null);
    const liveVariant = await insertVariant(liveParent, 'I693-MIG-LIVE-V');
    expect(await variantDeletedAt(goneVariant)).toBeNull();

    await runUp();

    expect(await variantDeletedAt(goneVariant)).toBe(DELETED_AT);
    expect(await variantDeletedAt(liveVariant)).toBeNull();
  });

  it('frees the SKUs a product deleted before the fix held, its variants\' included', async () => {
    const goneParent = await insertProduct('I693-MIG-REUSE', DELETED_AT);
    await insertVariant(goneParent, 'I693-MIG-REUSE-V');

    await runUp();

    const liveParent = await insertProduct('I693-MIG-REUSE', null);
    await insertVariant(liveParent, 'I693-MIG-REUSE-V');

    // Uniqueness still holds among live rows.
    await expectRefused(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "created_at", "updated_at")
       values (?, 'I693-MIG-REUSE', ?, 'simple', 'inactive', '', '', now(), now())`,
      [randomUUID(), `i693-dup-${randomUUID().slice(0, 8)}`],
      'products_sku_live_unique',
    );
    await expectRefused(
      `insert into "product_variants" ("id", "parent_product_id", "sku", "created_at", "updated_at") values (?, ?, 'I693-MIG-REUSE-V', now(), now())`,
      [randomUUID(), liveParent],
      'product_variants_sku_live_unique',
    );
  });

  it('replaces the table-wide constraints with partial unique indexes', async () => {
    await runUp();

    const constraints = (await em.execute(
      `select "conname" from "pg_constraint" where "conname" in ('products_sku_unique', 'product_variants_sku_unique')`,
    )) as Array<{ conname: string }>;
    expect(constraints).toEqual([]);

    const indexes = (await em.execute(
      `select "indexname", "indexdef" from "pg_indexes"
        where "indexname" in ('products_sku_live_unique', 'product_variants_sku_live_unique') order by "indexname"`,
    )) as Array<{ indexname: string; indexdef: string }>;
    expect(indexes.map((i) => i.indexname)).toEqual(['product_variants_sku_live_unique', 'products_sku_live_unique']);
    for (const index of indexes) {
      expect(index.indexdef).toMatch(/^CREATE UNIQUE INDEX/);
      expect(index.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
    }
  });
});
