import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InventoryStockReadService } from '../../../../packages/modules/inventory/src/backend/services/inventory-read-port.js';
import { Warehouse } from '../../helpers/package-entities.js';
import { DEFAULT_WAREHOUSE_ID } from '@endora-commerce/mod-inventory/backend';
import { WarehouseChannelAssignment } from '../../helpers/package-entities.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * `InventoryStockReadPort.listChannelWarehouses` (D-94.4).
 *
 * The method exists because `orders` was resolving channel → warehouse with a
 * hand-written knex join over two of this module's tables, inside the placement
 * transaction, with the empty-channel fallback spelled out of a UUID constant
 * imported from `warehouse.entity.ts`. Both halves are asserted here, on this
 * side of the boundary: the ordering placement walks, and the fallback.
 */
describe('listChannelWarehouses (D-94.4)', () => {
  let h: BackendServerHandle;
  let port: InventoryStockReadService;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new InventoryStockReadService(h.em);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const seedChannel = async (code: string): Promise<string> => {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code,
      name: { pl: code, en: code },
      languages: ['pl'],
      defaultLanguage: 'pl',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
    });
    await em.persistAndFlush(channel);
    return channel.id;
  };

  const seedWarehouse = async (code: string, active: boolean): Promise<string> => {
    const em = h.em();
    const warehouse = em.create(Warehouse, { name: code, code, active });
    await em.persistAndFlush(warehouse);
    return warehouse.id;
  };

  const bind = async (
    warehouseId: string,
    salesChannelId: string,
    isDefault: boolean,
    sortOrder: number,
  ): Promise<void> => {
    const em = h.em();
    em.persist(em.create(WarehouseChannelAssignment, { warehouseId, salesChannelId, isDefault, sortOrder }));
    await em.flush();
  };

  it('orders bound warehouses by isDefault, then sortOrder', async () => {
    const channelId = await seedChannel(`d94-order-${randomUUID().slice(0, 8)}`);
    const second = await seedWarehouse(`d94-b-${randomUUID().slice(0, 6)}`, true);
    const first = await seedWarehouse(`d94-a-${randomUUID().slice(0, 6)}`, true);
    const preferred = await seedWarehouse(`d94-z-${randomUUID().slice(0, 6)}`, true);
    await bind(second, channelId, false, 20);
    await bind(first, channelId, false, 10);
    // Default first, whatever its sort order and whatever its code — the
    // ordering is the assignment's, not the warehouse's.
    await bind(preferred, channelId, true, 99);

    const rows = await port.listChannelWarehouses(channelId);
    expect(rows.map((r) => r.warehouseId)).toEqual([preferred, first, second]);
    expect(rows[0]!.isDefault).toBe(true);
    expect(rows[0]!.warehouseCode).toMatch(/^d94-z-/);
  });

  it('leaves a deactivated warehouse out rather than standing in for it', async () => {
    const channelId = await seedChannel(`d94-inactive-${randomUUID().slice(0, 8)}`);
    const live = await seedWarehouse(`d94-live-${randomUUID().slice(0, 6)}`, true);
    const retired = await seedWarehouse(`d94-dead-${randomUUID().slice(0, 6)}`, false);
    await bind(live, channelId, false, 10);
    await bind(retired, channelId, false, 20);

    const rows = await port.listChannelWarehouses(channelId);
    expect(rows.map((r) => r.warehouseId)).toEqual([live]);
  });

  /**
   * The fallback that used to live in `orders`, as a `DEFAULT_WAREHOUSE_ID`
   * constant imported out of this module's entity file. It is reachable two
   * ways — a channel nobody bound a warehouse to, and a channel whose only
   * bound warehouses have been deactivated — and answering nothing for either
   * would refuse every line rather than allocate against the default.
   */
  it('falls back to the seeded default warehouse when the channel has no active binding', async () => {
    const unbound = await seedChannel(`d94-unbound-${randomUUID().slice(0, 8)}`);
    expect(await port.listChannelWarehouses(unbound)).toEqual([
      { warehouseId: DEFAULT_WAREHOUSE_ID, warehouseCode: 'default', isDefault: true },
    ]);

    const onlyInactive = await seedChannel(`d94-allsdead-${randomUUID().slice(0, 8)}`);
    const retired = await seedWarehouse(`d94-gone-${randomUUID().slice(0, 6)}`, false);
    await bind(retired, onlyInactive, true, 10);
    expect(await port.listChannelWarehouses(onlyInactive)).toEqual([
      { warehouseId: DEFAULT_WAREHOUSE_ID, warehouseCode: 'default', isDefault: true },
    ]);
  });
});
