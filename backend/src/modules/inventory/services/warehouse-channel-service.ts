import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { actorFromContext } from '../../../commands/index.js';
import { getTenantContext } from '../../../tenancy/index.js';
import { Warehouse } from '../entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';

export interface ChannelWarehouseAssignmentDTO {
  id: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  isDefault: boolean;
  sortOrder: number;
  assignedAt: string;
}

export interface AssignToChannelInput {
  warehouseId: string;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface PatchAssignmentInput {
  isDefault?: boolean;
  sortOrder?: number;
}

/**
 * WarehouseChannelService (US3) — manages the m:n binding between
 * warehouses and sales channels with at most one `isDefault = true`
 * row per channel.
 *
 * Invariants:
 *   - Every active channel must have at least one warehouse (refuse
 *     `unassign` when this would leave the channel orphaned).
 *   - At most one assignment per channel carries `isDefault = true`
 *     (`setDefault` demotes the previous default in the same flush).
 */
export class WarehouseChannelService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits assignment writes co-transactionally when provided. */
    private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Feature 054 — record a co-transactional audit entry for a bridge write on
   * the passed `em` (committed by the caller's flush). Actor is resolved from
   * the ambient TenantContext; the admin routes always carry one.
   */
  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (!this.auditLog) return;
    const ctx = getTenantContext();
    const actor = ctx ? actorFromContext(ctx) : null;
    this.auditLog.recordWithin(em, {
      action,
      objectType: 'warehouse_channel_assignment',
      objectId,
      actorAdminUserId: actor?.actorAdminUserId ?? null,
      impersonatedCustomerAccountId: actor?.impersonatedCustomerAccountId ?? null,
      stateBefore,
      stateAfter,
    });
  }

  async listForChannel(channelId: string): Promise<ChannelWarehouseAssignmentDTO[]> {
    const em = this.emFactory();
    const rows = await em.find(WarehouseChannelAssignment, { salesChannelId: channelId }, {
      orderBy: { sortOrder: 'asc', createdAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const warehouses = await em.find(Warehouse, { id: { $in: rows.map((r) => r.warehouseId) } });
    const byId = new Map(warehouses.map((w) => [w.id, w]));
    return rows.map((r) => ({
      id: r.id,
      warehouseId: r.warehouseId,
      warehouseName: byId.get(r.warehouseId)?.name ?? '',
      warehouseCode: byId.get(r.warehouseId)?.code ?? '',
      isDefault: r.isDefault,
      sortOrder: r.sortOrder,
      assignedAt: r.createdAt.toISOString(),
    }));
  }

  async listChannelsForWarehouse(warehouseId: string): Promise<Array<{
    salesChannelId: string;
    isDefault: boolean;
    sortOrder: number;
  }>> {
    const em = this.emFactory();
    const rows = await em.find(WarehouseChannelAssignment, { warehouseId });
    return rows.map((r) => ({
      salesChannelId: r.salesChannelId,
      isDefault: r.isDefault,
      sortOrder: r.sortOrder,
    }));
  }

  async assign(
    channelId: string,
    input: AssignToChannelInput,
  ): Promise<ChannelWarehouseAssignmentDTO> {
    const em = this.emFactory();
    const warehouse = await em.findOne(Warehouse, { id: input.warehouseId });
    if (!warehouse) {
      throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');
    }

    const existing = await em.findOne(WarehouseChannelAssignment, {
      salesChannelId: channelId,
      warehouseId: input.warehouseId,
    });
    if (existing) {
      // Idempotent — update sortOrder + isDefault per input but keep id.
      if (input.isDefault === true) {
        await this.demoteOtherDefaults(em, channelId, existing.id);
        existing.isDefault = true;
      }
      if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
      this.#audit(em, 'warehouse_channel.assign', existing.id, null, {
        warehouseId: existing.warehouseId,
        salesChannelId: channelId,
        isDefault: existing.isDefault,
        sortOrder: existing.sortOrder,
      });
      await em.flush();
      return this.toDTO(existing, warehouse);
    }

    if (input.isDefault === true) {
      await this.demoteOtherDefaults(em, channelId, null);
    }

    const row = em.create(WarehouseChannelAssignment, {
      warehouseId: input.warehouseId,
      salesChannelId: channelId,
      isDefault: input.isDefault ?? false,
      sortOrder: input.sortOrder ?? 0,
    });
    em.persist(row);
    this.#audit(em, 'warehouse_channel.assign', row.id, null, {
      warehouseId: row.warehouseId,
      salesChannelId: channelId,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
    });
    await em.flush();
    return this.toDTO(row, warehouse);
  }

  async patch(
    channelId: string,
    assignmentId: string,
    input: PatchAssignmentInput,
  ): Promise<ChannelWarehouseAssignmentDTO> {
    const em = this.emFactory();
    const row = await em.findOne(WarehouseChannelAssignment, {
      id: assignmentId,
      salesChannelId: channelId,
    });
    if (!row) {
      throw new HttpError(404, 'CHANNEL_WAREHOUSE_NOT_FOUND', 'Assignment not found');
    }
    if (input.isDefault === true && !row.isDefault) {
      await this.demoteOtherDefaults(em, channelId, row.id);
      row.isDefault = true;
    } else if (input.isDefault === false && row.isDefault) {
      // Refuse — channel must keep exactly one default. Operator should
      // promote a different assignment first.
      throw new HttpError(
        409,
        'CHANNEL_NO_WAREHOUSES',
        'Promote another warehouse to default before demoting this one',
      );
    }
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    this.#audit(em, 'warehouse_channel.update', row.id, null, {
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
    });
    await em.flush();
    const warehouse = await em.findOne(Warehouse, { id: row.warehouseId });
    return this.toDTO(row, warehouse!);
  }

  async unassign(channelId: string, assignmentId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(WarehouseChannelAssignment, {
      id: assignmentId,
      salesChannelId: channelId,
    });
    if (!row) {
      throw new HttpError(404, 'CHANNEL_WAREHOUSE_NOT_FOUND', 'Assignment not found');
    }
    const totalForChannel = await em.count(WarehouseChannelAssignment, {
      salesChannelId: channelId,
    });
    if (totalForChannel <= 1) {
      throw new HttpError(
        409,
        'CHANNEL_NO_WAREHOUSES',
        'Channel must have at least one warehouse; assign another before unassigning this one',
      );
    }
    if (row.isDefault) {
      throw new HttpError(
        409,
        'CHANNEL_NO_WAREHOUSES',
        'Promote another warehouse to default before unassigning the current default',
      );
    }
    this.#audit(em, 'warehouse_channel.unassign', row.id, {
      warehouseId: row.warehouseId,
      salesChannelId: channelId,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
    }, null);
    await em.removeAndFlush(row);
  }

  /**
   * Resolves the warehouses bound to a sales channel for the storefront
   * cumulative-on-hand readout (research §R7).
   */
  async resolveCandidateWarehouseIds(channelId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = await em.find(WarehouseChannelAssignment, { salesChannelId: channelId }, {
      orderBy: { isDefault: 'desc', sortOrder: 'asc', createdAt: 'asc' },
    });
    return rows.map((r) => r.warehouseId);
  }

  private async demoteOtherDefaults(
    em: EntityManager,
    channelId: string,
    keepId: string | null,
  ): Promise<void> {
    const where: Record<string, unknown> = { salesChannelId: channelId, isDefault: true };
    if (keepId) where['id'] = { $ne: keepId };
    const rows = await em.find(WarehouseChannelAssignment, where);
    for (const r of rows) r.isDefault = false;
  }

  private toDTO(
    row: WarehouseChannelAssignment,
    warehouse: Warehouse,
  ): ChannelWarehouseAssignmentDTO {
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
      assignedAt: row.createdAt.toISOString(),
    };
  }
}
