/**
 * `inventory`'s demo data (feature 113, T223 — contract §2).
 *
 * A second warehouse and its assignment to every sales channel, so the
 * inventory landing, the per-product roster and the channel-binding panels have
 * something to render. It writes `warehouses` and
 * `warehouse_channel_assignments`, both this module's own (§2.1).
 *
 * **The sales channels it reads are the kernel's, not another module's** (§2.2).
 * `sales_channels` moved to the kernel with the resolution machinery in feature
 * 072, and a module relating into the kernel by ORM is the sanctioned access
 * (D-87) — `WarehouseChannelReconciler`, three files away, reads it the same way
 * and says so in its own comment.
 *
 * **The stock spread is not here.** Quantities per product across two
 * warehouses are `catalog`'s rows and this module's rows in one statement, so
 * they are a composition step (§5.1) and live in the instance composition. This
 * body creates the warehouse that step spreads *into*, which is why the step is
 * written to degrade to a single-warehouse spread when it is absent.
 *
 * Idempotent by an existence probe on the fixed id (§2.4).
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Warehouse } from '../entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';
import { WarehouseChannelReconciler } from '../services/warehouse-channel-reconciler.js';
import { DEMO_ASSIGNMENT_SORT_ORDER, DEMO_WAREHOUSE } from './rows.js';

interface InventoryDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader.
  const em = context.ctx.cradle<InventoryDemoCradle>().emFactory();

  let warehouse = await em.findOne(Warehouse, { id: DEMO_WAREHOUSE.id });
  if (!warehouse) {
    warehouse = em.create(Warehouse, {
      id: DEMO_WAREHOUSE.id,
      name: DEMO_WAREHOUSE.name,
      code: DEMO_WAREHOUSE.code,
      active: DEMO_WAREHOUSE.active,
      description: DEMO_WAREHOUSE.description,
    });
    em.persist(warehouse);
    await em.flush();
  }

  // The demo seed runs before the process that will serve requests boots, so
  // the boot-time reconciler has not yet paired the channels the demo created
  // with the system warehouse. Running it inline leaves the database fully
  // wired without a server bounce — this is the module's own reconciler over
  // its own tables, and it is idempotent by construction.
  const reconciled = await new WarehouseChannelReconciler(em.fork()).run();

  const channels = await em.find(SalesChannel, {});
  let assignments = 0;
  for (const channel of channels) {
    const existing = await em.findOne(WarehouseChannelAssignment, {
      warehouseId: DEMO_WAREHOUSE.id,
      salesChannelId: channel.id,
    });
    if (existing) {
      assignments += 1;
      continue;
    }
    em.persist(
      em.create(WarehouseChannelAssignment, {
        warehouseId: DEMO_WAREHOUSE.id,
        salesChannelId: channel.id,
        isDefault: false,
        sortOrder: DEMO_ASSIGNMENT_SORT_ORDER,
      }),
    );
    assignments += 1;
  }
  await em.flush();

  return {
    created: [
      { entity: 'Warehouse', count: 1 },
      { entity: 'WarehouseChannelAssignment', count: assignments },
    ],
    ...(reconciled.assignmentsCreated === 0
      ? {}
      : {
          notes: [
            `paired ${reconciled.assignmentsCreated} sales channel(s) with the system ` +
              'warehouse, which the boot reconciler had not seen yet',
          ],
        }),
  };
}
