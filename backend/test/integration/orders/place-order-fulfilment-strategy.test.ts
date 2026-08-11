import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import type { FulfilmentStrategy } from '@b2b/contracts';
import {
  DEFAULT_WAREHOUSE_ID,
  Warehouse,
} from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../../../src/modules/inventory/entities/warehouse-channel-assignment.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';
import { StockAllocation } from '../../../src/modules/inventory/entities/stock-allocation.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * Integration — order placement honors the configurable warehouse-picking
 * (fulfilment) strategy with precedence Product > Organization > Sales Channel
 * (setting) > platform default.
 *
 * Two warehouses hold the same product with different on-hand (default = 10,
 * secondary = 100). The chosen warehouse changes as we move the strategy
 * override up and down the precedence chain, observed via stock_allocations.
 */
const SECONDARY_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d018';

describe('place order — configurable fulfilment strategy precedence', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const channel = await em.findOne(SalesChannel, { status: 'active' });
    if (!channel) throw new Error('no active sales channel seeded');

    // Second active warehouse alongside the seeded default. The `warehouses`
    // table is not truncated between runs, so create it only once.
    const existingSecondary = await em.findOne(Warehouse, { id: SECONDARY_WAREHOUSE_ID });
    if (!existingSecondary) {
      const secondary = em.create(Warehouse, {
        id: SECONDARY_WAREHOUSE_ID,
        code: 'wh-2',
        name: 'Secondary',
        active: true,
      });
      await em.persistAndFlush(secondary);
    }

    // Deterministic candidate set: default (is_default) + secondary, both on
    // the active channel.
    const knex = em.getKnex();
    await knex('warehouse_channel_assignments').where('sales_channel_id', channel.id).delete();
    em.create(WarehouseChannelAssignment, {
      warehouseId: DEFAULT_WAREHOUSE_ID,
      salesChannelId: channel.id,
      isDefault: true,
      sortOrder: 0,
    });
    em.create(WarehouseChannelAssignment, {
      warehouseId: SECONDARY_WAREHOUSE_ID,
      salesChannelId: channel.id,
      isDefault: false,
      sortOrder: 1,
    });
    await em.flush();

    // Default warehouse = the lowest-stock one (10); secondary = highest (100).
    await knex('stock_levels')
      .where({ product_id: SEED_PRODUCT_101_ID, warehouse_id: DEFAULT_WAREHOUSE_ID })
      .update({ on_hand: 10, reserved: 0 });
    em.create(StockLevel, {
      productId: SEED_PRODUCT_101_ID,
      warehouseId: SECONDARY_WAREHOUSE_ID,
      onHand: 100,
      reserved: 0,
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Sets the org-level strategy override (or clears it with null). */
  async function setOrgStrategy(strategy: FulfilmentStrategy | null): Promise<void> {
    const em = h.em();
    const org = await em.findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    org.fulfilmentStrategy = strategy;
    await em.flush();
  }

  /** Sets the product-level strategy override (or clears it with null). */
  async function setProductStrategy(strategy: FulfilmentStrategy | null): Promise<void> {
    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    product.fulfilmentStrategy = strategy;
    await em.flush();
  }

  /** Places a 1-unit order as the stub customer and returns the warehouse the
   *  single line was allocated from. */
  async function placeAndGetWarehouse(): Promise<string> {
    const cookies = { b2b_session: 'stub-customer-session' };
    const addCart = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies,
    });
    expect(addCart.statusCode).toBe(200);

    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies,
    });
    expect(place.statusCode).toBe(201);
    const orderId = (place.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const items = await em.find(OrderItem, { orderId });
    const allocations = await em.find(StockAllocation, {
      orderItemId: { $in: items.map((i) => i.id) },
    });
    expect(allocations.length).toBe(1);
    return allocations[0]!.warehouseId;
  }

  it('uses the channel default (default_first) when neither product nor org override', async () => {
    await setProductStrategy(null);
    await setOrgStrategy(null);
    expect(await placeAndGetWarehouse()).toBe(DEFAULT_WAREHOUSE_ID);
  });

  it('honors the organization override over the channel default', async () => {
    await setProductStrategy(null);
    await setOrgStrategy('highest_stock_first');
    expect(await placeAndGetWarehouse()).toBe(SECONDARY_WAREHOUSE_ID);
  });

  it('lets the product override win over the organization override', async () => {
    await setOrgStrategy('highest_stock_first');
    await setProductStrategy('lowest_stock_first');
    expect(await placeAndGetWarehouse()).toBe(DEFAULT_WAREHOUSE_ID);
  });
});
