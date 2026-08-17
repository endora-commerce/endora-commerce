import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CandidateWarehouse,
  InventoryStockReadPort,
  StockLevelRecord,
  WarehouseChannelAssignmentRecord,
  WarehouseRecord,
} from '@b2b/contracts';
import { StockLevel } from '../entities/stock-level.entity.js';
import { Warehouse } from '../entities/warehouse.entity.js';
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
