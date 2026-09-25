import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Migration } from '@mikro-orm/migrations';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Category, Product } from '../../helpers/package-entities.js';
import { Migration20260925T125527CatalogInventoryColumns } from '../../../../packages/modules/catalog/src/migrations/20260925T125527_catalog_inventory_columns.js';

/**
 * `catalog` creates the nine columns its entities map and `inventory` used to
 * create — feature 134's T120, `specs/134-paid-module-extraction/research.md`
 * D15 and FR-065.
 *
 * `Product` maps `manageStock`, `backorderEnabled`, `lowStockThreshold`,
 * `lowStockThresholdMode`, `fulfilmentStrategy` and
 * `fulfilmentStrategyWarehouseOrder`; `Category` maps the three
 * `inventoryThreshold*` columns. Until this repair only `inventory`'s
 * migrations created them, so an instance assembled without `inventory` — the
 * default free set — could not read a product, and `inventory`'s hard
 * uninstall dropped them.
 *
 * D15 §3's regimes are driven inside one transaction that is rolled back
 * (Postgres DDL is transactional): the "fresh instance without `inventory`"
 * row by dropping the nine columns and both constraints first, the "existing
 * database" row as the schema stands.
 */

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

async function queued(cls: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = new cls(db.orm.em.getDriver(), db.orm.config);
  await migration[direction]();
  return migration.getQueries().map((query) => query.toString());
}

async function run(cls: MigrationClass, direction: 'up' | 'down'): Promise<void> {
  for (const sql of await queued(cls, direction)) await db.em().execute(sql);
}

const PRODUCT_COLUMNS = [
  'manage_stock',
  'backorder_enabled',
  'low_stock_threshold',
  'low_stock_threshold_mode',
  'fulfilment_strategy',
  'fulfilment_strategy_warehouse_order',
] as const;
const CATEGORY_COLUMNS = [
  'inventory_threshold_high',
  'inventory_threshold_medium',
  'inventory_threshold_low',
] as const;
const CONSTRAINTS = [
  'products_fulfilment_strategy_check',
  'products_low_stock_threshold_mode_check',
] as const;

async function dropEverythingInventoryUsedToCreate(em: EntityManager): Promise<void> {
  for (const name of CONSTRAINTS) {
    await em.execute(`alter table "products" drop constraint "${name}"`);
  }
  for (const column of PRODUCT_COLUMNS) {
    await em.execute(`alter table "products" drop column "${column}"`);
  }
  for (const column of CATEGORY_COLUMNS) {
    await em.execute(`alter table "categories" drop column "${column}"`);
  }
}

async function columnCount(em: EntityManager, table: string, columns: readonly string[]) {
  const rows = await em.execute<{ n: string }[]>(
    `select count(*)::text as n from information_schema.columns
      where table_schema = current_schema() and table_name = ? and column_name in (${columns
        .map(() => '?')
        .join(', ')})`,
    [table, ...columns],
  );
  return Number(rows[0]!.n);
}

async function constraintCount(em: EntityManager, name: string): Promise<number> {
  const rows = await em.execute<{ n: string }[]>(
    `select count(*)::text as n from pg_constraint
      where conname = ? and conrelid = '"products"'::regclass`,
    [name],
  );
  return Number(rows[0]!.n);
}

async function seedRows(em: EntityManager): Promise<{ productId: string; categoryId: string }> {
  const product = em.create(Product, {
    type: 'simple',
    sku: `INVCOL-${Date.now()}`,
    slug: `invcol-${Date.now()}`,
    status: 'draft',
    visibility: 'public',
    name: { 'en-US': 'Inventory columns' },
    description: {},
    attributeValues: {},
    manageStock: false,
    backorderEnabled: true,
    lowStockThreshold: 7,
    lowStockThresholdMode: 'per_warehouse',
    fulfilmentStrategy: 'defined_order',
    fulfilmentStrategyWarehouseOrder: ['a', 'b'],
  });
  const category = em.create(Category, {
    name: { 'en-US': 'Inventory columns' },
    slug: `invcol-${Date.now()}`,
    inventoryThresholdHigh: 50,
    inventoryThresholdMedium: 10,
    inventoryThresholdLow: 2,
  });
  await em.persistAndFlush([product, category]);
  return { productId: product.id, categoryId: category.id };
}

async function productRow(em: EntityManager, id: string) {
  const rows = await em.execute<Record<string, unknown>[]>(
    `select ${PRODUCT_COLUMNS.map((c) => `"${c}"`).join(', ')} from "products" where id = ?`,
    [id],
  );
  return rows[0]!;
}

async function categoryRow(em: EntityManager, id: string) {
  const rows = await em.execute<Record<string, unknown>[]>(
    `select ${CATEGORY_COLUMNS.map((c) => `"${c}"`).join(', ')} from "categories" where id = ?`,
    [id],
  );
  return rows[0]!;
}

describe('catalog’s inventory columns — every regime converges (D15 §3)', () => {
  it('fresh instance without inventory: up() creates the nine columns with their original defaults', async () => {
    const em = db.em();
    const { productId, categoryId } = await seedRows(em);
    await dropEverythingInventoryUsedToCreate(em);
    expect(await columnCount(em, 'products', PRODUCT_COLUMNS)).toBe(0);
    expect(await columnCount(em, 'categories', CATEGORY_COLUMNS)).toBe(0);

    await run(Migration20260925T125527CatalogInventoryColumns, 'up');

    expect(await productRow(em, productId)).toEqual({
      manage_stock: true,
      backorder_enabled: false,
      low_stock_threshold: null,
      low_stock_threshold_mode: 'cumulative',
      fulfilment_strategy: null,
      fulfilment_strategy_warehouse_order: null,
    });
    expect(await categoryRow(em, categoryId)).toEqual({
      inventory_threshold_high: null,
      inventory_threshold_medium: null,
      inventory_threshold_low: null,
    });
    for (const name of CONSTRAINTS) expect(await constraintCount(em, name)).toBe(1);
  });

  it('both recreated constraints reject an out-of-set value', async () => {
    const em = db.em();
    const { productId } = await seedRows(em);
    await dropEverythingInventoryUsedToCreate(em);
    await run(Migration20260925T125527CatalogInventoryColumns, 'up');

    await em.execute('savepoint invcol_strategy');
    await expect(
      em.execute(`update "products" set "fulfilment_strategy" = 'nearest' where id = ?`, [
        productId,
      ]),
    ).rejects.toThrow(/products_fulfilment_strategy_check/);
    await em.execute('rollback to savepoint invcol_strategy');

    await em.execute('savepoint invcol_mode');
    await expect(
      em.execute(`update "products" set "low_stock_threshold_mode" = 'per_channel' where id = ?`, [
        productId,
      ]),
    ).rejects.toThrow(/products_low_stock_threshold_mode_check/);
    await em.execute('rollback to savepoint invcol_mode');
  });

  it('existing database: up() changes nothing, keeps every value and duplicates no constraint', async () => {
    const em = db.em();
    const { productId, categoryId } = await seedRows(em);
    const productBefore = await productRow(em, productId);
    const categoryBefore = await categoryRow(em, categoryId);

    await run(Migration20260925T125527CatalogInventoryColumns, 'up');

    expect(await productRow(em, productId)).toEqual(productBefore);
    expect(productBefore).toMatchObject({ manage_stock: false, low_stock_threshold: 7 });
    expect(await categoryRow(em, categoryId)).toEqual(categoryBefore);
    for (const name of CONSTRAINTS) expect(await constraintCount(em, name)).toBe(1);
  });

  it('down() issues no SQL — products and categories outlive catalog', async () => {
    expect(await queued(Migration20260925T125527CatalogInventoryColumns, 'down')).toEqual([]);
  });
});
