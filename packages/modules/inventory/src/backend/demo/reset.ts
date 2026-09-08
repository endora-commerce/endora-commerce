/**
 * Withdraw `inventory`'s demo data (feature 113, T223 — contract §2.5).
 *
 * The demo warehouse by its fixed id, and its channel assignments with it. The
 * assignments the reconciler made for the **system** warehouse are left alone:
 * they are the platform's own invariant — every active channel has a default
 * warehouse — and not something this demo created, even though a demo run is
 * what caused the reconciler to notice a channel it had not seen.
 *
 * The stock the composition spread across this warehouse is the composition's
 * to withdraw, and it does so first: `reset` runs the composition's withdrawal
 * before any module's (§5.5), which is also what leaves no `stock_levels` row
 * pointing at the warehouse deleted below.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Warehouse } from '../entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';
import { DEMO_WAREHOUSE } from './rows.js';

interface InventoryDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<InventoryDemoCradle>().emFactory();
  const assignments = await em.nativeDelete(WarehouseChannelAssignment, {
    warehouseId: DEMO_WAREHOUSE.id,
  });
  const warehouses = await em.nativeDelete(Warehouse, { id: DEMO_WAREHOUSE.id });
  return {
    removed: [
      { entity: 'Warehouse', count: warehouses },
      { entity: 'WarehouseChannelAssignment', count: assignments },
    ],
  };
}
