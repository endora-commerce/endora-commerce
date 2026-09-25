import { describe, expect, it } from 'vitest';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20260503T182812InventoryWorkflow } from './migrations/20260503T182812_inventory_workflow.js';
import { Migration20260611T140348InventoryPerWarehouseLowStockThresholds } from './migrations/20260611T140348_inventory_per_warehouse_low_stock_thresholds.js';

/**
 * `inventory`'s migrations issue no DDL on `catalog`'s tables — feature 134's
 * T120, `specs/134-paid-module-extraction/research.md` D15 §3.
 *
 * Two of them used to add nine columns and two check constraints to
 * `products` and `categories`, which `catalog`'s entities map. `catalog` now
 * creates them itself with `if not exists`, and these two migrations were
 * **trimmed**, not emptied: each also creates `inventory`'s own schema, and an
 * emptied body would delete that schema from every fresh install. So the test
 * holds both halves — nothing names `catalog`'s tables, and each migration
 * still issues its own statements.
 *
 * The one statement allowed to name `products` is `20260611T140348`'s
 * `pwlst_product_fk`: a foreign key **from** `inventory`'s own table to
 * `products`, a writer → owner edge that `catalog` in `inventory`'s closure
 * already satisfies.
 *
 * It sits beside `migrations/` rather than inside it, because every `.ts` file
 * in a migrations directory has to be a migration or its barrel
 * (`backend/test/unit/db/migrations-registry.test.ts`).
 */

type MigrationClass = new (...args: ConstructorParameters<typeof Migration>) => Migration;

/** What `up()` or `down()` queues. `addSql` touches neither driver nor config. */
async function statementsOf(cls: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  const migration = new cls(undefined as never, undefined as never);
  await migration[direction]();
  return migration.getQueries().map((query) => String(query));
}

const NAMES_A_CATALOG_TABLE = /"(?:products|categories)"/;
const ALLOWED_REFERENCE = 'pwlst_product_fk';

const CASES = [
  {
    cls: Migration20260503T182812InventoryWorkflow,
    own: { up: /create table "warehouses"/, down: /drop table if exists "warehouses"/ },
  },
  {
    cls: Migration20260611T140348InventoryPerWarehouseLowStockThresholds,
    own: {
      up: /create table "product_warehouse_low_stock_thresholds"/,
      down: /drop table if exists "product_warehouse_low_stock_thresholds"/,
    },
  },
] as const;

describe('inventory’s migrations leave catalog’s tables to catalog (D15 §3)', () => {
  for (const { cls, own } of CASES) {
    for (const direction of ['up', 'down'] as const) {
      it(`${cls.name}.${direction}() names neither products nor categories`, async () => {
        const foreign = (await statementsOf(cls, direction)).filter(
          (sql) => NAMES_A_CATALOG_TABLE.test(sql) && !sql.includes(ALLOWED_REFERENCE),
        );
        expect(foreign).toEqual([]);
      });

      it(`${cls.name}.${direction}() still issues inventory’s own statements`, async () => {
        expect((await statementsOf(cls, direction)).some((sql) => own[direction].test(sql))).toBe(
          true,
        );
      });
    }
  }
});
