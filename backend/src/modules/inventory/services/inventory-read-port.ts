import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CandidateWarehouse,
  ChannelWarehouse,
  InventoryStockReadPort,
  StockLevelRecord,
  WarehouseChannelAssignmentRecord,
  WarehouseRecord,
} from '@b2b/contracts';
import { StockLevel } from '../entities/stock-level.entity.js';
import {
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_ID,
  Warehouse,
} from '../entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';

/**
 * The stock read model `inventory` publishes (feature 075, Phase P).
 *
 * `orders` reads stock at placement, and it does so through a **dynamic**
 * import inside a method body — invisible to a reviewer scanning the import
 * block, which is why the boundary check was taught to see one. What it
 * assembles there is this module's business: candidate warehouses for a line
 * on a channel, with `available = onHand - reserved`, joined across three
 * tables and ordered by warehouse code.
 *
 * `candidatesFor` is therefore the method with no direct predecessor — the
 * others are transcriptions. It exists because the assembly, not the rows, is
 * what the caller wanted, and assembling it in `orders` put this module's join
 * in another module's transaction.
 */
export class InventoryStockReadService implements InventoryStockReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listStockForProducts(
    productIds: readonly string[],
    options?: { warehouseId?: string },
  ): Promise<StockLevelRecord[]> {
    if (productIds.length === 0) return [];
    const rows = await this.emFactory().find(StockLevel, {
      productId: { $in: [...productIds] },
      ...(options?.warehouseId ? { warehouseId: options.warehouseId } : {}),
    });
    return rows.map(toStockLevelRecord);
  }

  async listWarehouses(options?: { activeOnly?: boolean }): Promise<WarehouseRecord[]> {
    const rows = await this.emFactory().find(
      Warehouse,
      options?.activeOnly ? { active: true } : {},
      { orderBy: { code: 'asc' } },
    );
    return rows.map(toWarehouseRecord);
  }

  async listChannelAssignments(
    salesChannelId: string,
  ): Promise<WarehouseChannelAssignmentRecord[]> {
    const rows = await this.emFactory().find(
      WarehouseChannelAssignment,
      { salesChannelId },
      { orderBy: { sortOrder: 'asc', id: 'asc' } },
    );
    return rows.map(toWarehouseChannelAssignmentRecord);
  }

  /**
   * The channel → warehouse binding placement allocates against (D-94.4).
   *
   * This was a knex join inside `orders`' placement transaction —
   * `warehouse_channel_assignments as a` joined to `warehouses as w`, two of
   * this module's tables named by hand in another module's method body, with
   * the empty-channel fallback spelled out of a UUID constant copied from
   * `warehouse.entity.ts`. Both halves are this module's business, so both are
   * here: the ordering placement walks (`isDefault desc, sortOrder asc,
   * createdAt asc`, which is *not* `listChannelAssignments`' ordering) and the
   * default-warehouse fallback.
   *
   * The fallback is not dead code kept for tests. The boot-time
   * `WarehouseChannelReconciler` binds the default warehouse to every channel,
   * so a production deployment does not reach it — but a seed-skipped
   * environment, and a channel whose only bound warehouses have been
   * deactivated, both do, and answering nothing there would refuse every line
   * rather than allocate against the default.
   *
   * Read through this module's own `EntityManager`, deliberately: it is the
   * *binding*, not the stock. The caller reads and locks `stock_levels` itself,
   * on its own transaction — see the port's doc comment for why
   * `candidatesFor` cannot stand in here.
   */
  async listChannelWarehouses(salesChannelId: string): Promise<ChannelWarehouse[]> {
    const em = this.emFactory();
    const assignments = await em.find(
      WarehouseChannelAssignment,
      { salesChannelId },
      { orderBy: { isDefault: 'desc', sortOrder: 'asc', createdAt: 'asc' } },
    );
    if (assignments.length > 0) {
      const warehouses = await em.find(Warehouse, {
        active: true,
        id: { $in: assignments.map((a) => a.warehouseId) },
      });
      const byId = new Map(warehouses.map((w) => [w.id, w]));
      const bound = assignments.flatMap((assignment) => {
        const warehouse = byId.get(assignment.warehouseId);
        // The `active` filter is a join condition, not a post-filter with a
        // fabricated stand-in: a deactivated warehouse is not a candidate.
        if (!warehouse) return [];
        return [
          {
            warehouseId: assignment.warehouseId,
            warehouseCode: warehouse.code,
            isDefault: assignment.isDefault,
          },
        ];
      });
      if (bound.length > 0) return bound;
    }
    return [
      {
        warehouseId: DEFAULT_WAREHOUSE_ID,
        warehouseCode: DEFAULT_WAREHOUSE_CODE,
        isDefault: true,
      },
    ];
  }

  async candidatesFor(input: {
    productId: string;
    variantId?: string | null;
    salesChannelId: string | null;
  }): Promise<CandidateWarehouse[]> {
    const em = this.emFactory();

    // Which warehouses serve this channel. No channel, or a channel nobody
    // assigned a warehouse to, means "every active warehouse" — the same
    // fallback the availability resolver already applies, so a deployment that
    // never configured the channel mapping keeps working.
    const assignments =
      input.salesChannelId === null
        ? []
        : await em.find(WarehouseChannelAssignment, { salesChannelId: input.salesChannelId });
    const assignedIds = assignments.map((a) => a.warehouseId);
    const defaultIds = new Set(assignments.filter((a) => a.isDefault).map((a) => a.warehouseId));

    const warehouses = await em.find(
      Warehouse,
      { active: true, ...(assignedIds.length > 0 ? { id: { $in: assignedIds } } : {}) },
      { orderBy: { code: 'asc' } },
    );
    if (warehouses.length === 0) return [];

    const stock = await em.find(StockLevel, {
      productId: input.productId,
      variantId: input.variantId ?? null,
      warehouseId: { $in: warehouses.map((w) => w.id) },
    });
    const byWarehouse = new Map(stock.map((s) => [s.warehouseId, s]));

    return warehouses.map((warehouse) => {
      const level = byWarehouse.get(warehouse.id);
      return {
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        available: level ? level.onHand - level.reserved : 0,
        isDefault: defaultIds.has(warehouse.id),
      };
    });
  }
}

export function toWarehouseRecord(warehouse: Warehouse): WarehouseRecord {
  return {
    id: warehouse.id,
    name: warehouse.name,
    code: warehouse.code,
    active: warehouse.active,
    description: warehouse.description ?? null,
    address: warehouse.address ?? null,
    contactName: warehouse.contactName ?? null,
    contactEmail: warehouse.contactEmail ?? null,
    contactPhone: warehouse.contactPhone ?? null,
    defaultLowStockThreshold: warehouse.defaultLowStockThreshold ?? null,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
  };
}

export function toStockLevelRecord(level: StockLevel): StockLevelRecord {
  return {
    id: level.id,
    productId: level.productId,
    variantId: level.variantId ?? null,
    warehouseId: level.warehouseId,
    onHand: level.onHand,
    reserved: level.reserved,
    createdAt: level.createdAt,
    updatedAt: level.updatedAt,
  };
}

export function toWarehouseChannelAssignmentRecord(
  assignment: WarehouseChannelAssignment,
): WarehouseChannelAssignmentRecord {
  return {
    id: assignment.id,
    warehouseId: assignment.warehouseId,
    salesChannelId: assignment.salesChannelId,
    isDefault: assignment.isDefault,
    sortOrder: assignment.sortOrder,
    createdAt: assignment.createdAt,
  };
}
