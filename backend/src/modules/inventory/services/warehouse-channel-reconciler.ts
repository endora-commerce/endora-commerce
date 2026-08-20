import type { EntityManager } from '@mikro-orm/postgresql';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';
import { Warehouse, DEFAULT_WAREHOUSE_ID } from '../entities/warehouse.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';

/**
 * WarehouseChannelReconciler — idempotent boot-time check that every
 * active sales channel has at least one warehouse assigned and that
 * exactly one of those assignments carries `isDefault = true`.
 *
 * Why a runtime reconciler: the inventory migration cannot know about
 * future channels because the DefaultChannelReconciler creates the
 * platform's first channel at boot time, AFTER migrations run. This
 * reconciler runs after every boot and catches up.
 */
export class WarehouseChannelReconciler {
  constructor(private readonly em: EntityManager) {}

  async run(): Promise<{ assignmentsCreated: number }> {
    // command-coverage-ignore: startup reconciler — backfills the default
    // warehouse↔channel assignment for channels missing one, an idempotent
    // system-invariant repair, not an operator-initiated audited write.
    // The kernel's own entity, not `select id from sales_channels` (feature 075,
    // D-87). `sales_channels` is the kernel's table since feature 072 moved the
    // resolution machinery there, and a module relating into the kernel by ORM
    // is the sanctioned access.
    //
    // Read through `this.em`, not through a knex handle and not through
    // `salesChannelResolutionPort` — both take their own pooled connection, so
    // the channel list would be read from outside any transaction the caller
    // holds open while the assignments below are written through `this.em` from
    // inside it (issue #207).
    const channels = await this.em.find(SalesChannel, {}, { fields: ['id'] });
    if (channels.length === 0) return { assignmentsCreated: 0 };

    const defaultWarehouse = await this.em.findOne(Warehouse, { id: DEFAULT_WAREHOUSE_ID });
    if (!defaultWarehouse) {
      // Migration 030 should have seeded this — bail rather than silently
      // creating a row with a dangling foreign key.
      return { assignmentsCreated: 0 };
    }

    let created = 0;
    for (const channel of channels) {
      const existing = await this.em.find(WarehouseChannelAssignment, {
        salesChannelId: channel.id,
      });
      if (existing.length === 0) {
        const row = this.em.create(WarehouseChannelAssignment, {
          warehouseId: DEFAULT_WAREHOUSE_ID,
          salesChannelId: channel.id,
          isDefault: true,
        });
        await this.em.persistAndFlush(row);
        created += 1;
      } else if (!existing.some((a) => a.isDefault)) {
        // Channel has assignments but no default — promote the first one.
        existing[0]!.isDefault = true;
        await this.em.flush();
      }
    }
    return { assignmentsCreated: created };
  }
}
