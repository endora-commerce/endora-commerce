import type { EntityManager } from '@mikro-orm/postgresql';
import { WarehouseChannelAssignment } from '../entities/warehouse-channel-assignment.entity.js';
import { Warehouse, DEFAULT_WAREHOUSE_ID } from '../entities/warehouse.entity.js';

interface ChannelRow {
  id: string;
}

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
    const knex = this.em.getKnex();
    const channels = await knex<ChannelRow>('sales_channels').select<ChannelRow[]>('id');
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
