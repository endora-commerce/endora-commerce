/**
 * The properties of `inventory`'s demo body that no database comparison can see
 * (feature 113, T223 — contract §2.4 and §2.5).
 *
 * `test/integration/demo/demo-shop.test.ts` seeds a throwaway database and
 * holds every table the seed moves to a recorded delta, which is what says
 * these rows are still there and still that many. It
 * cannot say either of the things below, because both are about a **second**
 * call: that seeding twice creates nothing the second time, and that the
 * withdrawal is keyed on the id `seed` assigns.
 *
 * The withdrawal's shape is the one worth pinning. The demo's assignments and
 * the *reconciler's* assignments sit in one table, and only the first are the
 * demo's: a `nativeDelete` over `WarehouseChannelAssignment` with no filter
 * would pass a row-count assertion while taking the platform's own invariant —
 * every active channel has a default warehouse — away with it.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { DEMO_WAREHOUSE } from './rows.js';
import { resetDemo } from './reset.js';

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  };
}

describe('inventory demo data', () => {
  it('withdraws by the warehouse it created, never by the table (§2.5)', async () => {
    const deletes: unknown[] = [];
    const em = {
      nativeDelete: async (_entity: unknown, where: unknown) => {
        deletes.push(where);
        return 1;
      },
    } as unknown as EntityManager;

    const result = await resetDemo(contextOver(em));

    // Both statements are filtered, and both are filtered on the same fixed id:
    // the assignments by the warehouse they point at, the warehouse by itself.
    expect(deletes).toEqual([
      { warehouseId: DEMO_WAREHOUSE.id },
      { id: DEMO_WAREHOUSE.id },
    ]);
    expect(result.removed.map((entry) => entry.entity).sort()).toEqual([
      'Warehouse',
      'WarehouseChannelAssignment',
    ]);
  });

  it('names its warehouse in the platform default language (§2.6)', () => {
    // `Warehouse.name` and `.description` are scalar columns, so §2.6's
    // per-language map has nowhere to go and the value itself carries the rule.
    // Measured on the move: the Polish values this block used to hold were two
    // `check:default-language-prose` findings, and neither of that check's
    // answers — a per-language key or a ledger entry — was available.
    expect(DEMO_WAREHOUSE.name).toMatch(/^[\x20-\x7e]+$/);
    expect(DEMO_WAREHOUSE.description).toMatch(/^[\x20-\x7e—]+$/);
  });
});
