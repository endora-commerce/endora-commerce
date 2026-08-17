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
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import {
  DEFAULT_WAREHOUSE_ID,
  Warehouse,
} from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { WarehouseChannelAssignment } from '../../../src/modules/inventory/entities/warehouse-channel-assignment.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';
import { StockAllocation } from '../../../src/modules/inventory/entities/stock-allocation.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';

/**
 * Issue #62 — the seven per-channel settings `orders` reads at placement.
 *
 * `commerceModule` takes nine `resolve…(salesChannelId)` closures. Until
 * feature 072 T141 the harness passed two, and each of the seven it omitted is
 * documented as *"Omit ⇒ <the feature is off>"* — so their absence did not
 * change a value, it removed a behaviour. The module reads all nine itself now,
 * which made both compositions run the same code; nothing had yet read one of
 * the seven **back**.
 *
 * Every case below sets the value through the operator's own write seam
 * (`setValueForSubset`, i.e. a per-channel override on the channel a
 * header-less storefront request resolves to) and observes the behaviour change
 * over HTTP. That is deliberate, and it is the trap issue #61 names: a settings
 * test that asserts a value the harness itself hard-coded proves the harness,
 * not the read. Each case is written so that ignoring the setting flips the
 * assertion — the order number loses its affixes, the below-minimum order is
 * accepted, the reorder succeeds, the extra confirmation is never sent, the
 * allocation lands in the other warehouse.
 *
 * `inventory.fulfilment_strategy` and its warehouse order are declared by
 * `inventory` and read by `orders` at placement; they are on this list because
 * the read is the one under test, not the declaration.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const SECONDARY_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d019';

const SETTING = {
  businessIdPrefix: 'orders.business_id.prefix',
  businessIdSuffix: 'orders.business_id.suffix',
  minOrderValue: 'orders.min_order_value',
  reorderEnabled: 'orders.reorder_enabled',
  confirmationRecipients: 'orders.confirmation_recipients',
  fulfilmentStrategy: 'inventory.fulfilment_strategy',
  fulfilmentWarehouseOrder: 'inventory.fulfilment_strategy_warehouse_order',
} as const;

/** The manifest default each case restores, so the file's cases stay independent. */
const MANIFEST_DEFAULT: Record<string, unknown> = {
  [SETTING.businessIdPrefix]: '',
  [SETTING.businessIdSuffix]: '',
  [SETTING.minOrderValue]: 0,
  [SETTING.reorderEnabled]: true,
  [SETTING.confirmationRecipients]: [],
  [SETTING.fulfilmentStrategy]: 'default_first',
  [SETTING.fulfilmentWarehouseOrder]: [],
};

describe('order placement — the seven per-channel settings', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  const mailer = new InMemoryMailer();

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;

    // Two warehouses on the channel with different on-hand, so the picked one
    // is an observable consequence of the strategy rather than of there being
    // only one candidate. `warehouses` is not truncated between runs.
    if (!(await em.findOne(Warehouse, { id: SECONDARY_WAREHOUSE_ID }))) {
      em.create(Warehouse, {
        id: SECONDARY_WAREHOUSE_ID,
        code: 'wh-channel-settings',
        name: 'Channel settings secondary',
        active: true,
      });
      await em.flush();
    }
    const knex = em.getKnex();
    await knex('warehouse_channel_assignments').where('sales_channel_id', channelId).delete();
    em.create(WarehouseChannelAssignment, {
      warehouseId: DEFAULT_WAREHOUSE_ID,
      salesChannelId: channelId,
      isDefault: true,
      sortOrder: 0,
    });
    em.create(WarehouseChannelAssignment, {
      warehouseId: SECONDARY_WAREHOUSE_ID,
      salesChannelId: channelId,
      isDefault: false,
      sortOrder: 1,
    });
    await em.flush();

    await knex('stock_levels')
      .where({ product_id: SEED_PRODUCT_101_ID, warehouse_id: DEFAULT_WAREHOUSE_ID })
      .update({ on_hand: 10, reserved: 0 });
    if (
      !(await em.findOne(StockLevel, {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: SECONDARY_WAREHOUSE_ID,
      }))
    ) {
      em.create(StockLevel, {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: SECONDARY_WAREHOUSE_ID,
        onHand: 100,
        reserved: 0,
      });
      await em.flush();
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A per-channel override on the resolved channel, written the way the admin screen writes it. */
  async function setChannelValue(code: string, value: unknown): Promise<void> {
    await h.settings.adminService.setValueForSubset(code, [channelCode], value, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate(code);
  }

  async function withChannelValue<T>(
    code: string,
    value: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    await setChannelValue(code, value);
    try {
      return await run();
    } finally {
      await setChannelValue(code, MANIFEST_DEFAULT[code]);
    }
  }

  async function addToCart(quantity: number): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
      cookies: COOKIE,
    });
    expect(res.statusCode).toBe(200);
  }

  /** Places the active cart. The channel is named so the request resolves to the one under test. */
  async function place(): Promise<{ statusCode: number; body: unknown }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        salesChannelId: channelId,
      },
      cookies: COOKIE,
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  async function placeOk(): Promise<{ id: string; businessId: string }> {
    const res = await place();
    expect(res.statusCode).toBe(201);
    return (res.body as { data: { id: string; businessId: string } }).data;
  }

  /** The warehouse the single line of `orderId` was allocated from. */
  async function allocatedWarehouse(orderId: string): Promise<string> {
    const em = h.em();
    const items = await em.find(OrderItem, { orderId });
    const allocations = await em.find(StockAllocation, {
      orderItemId: { $in: items.map((i) => i.id) },
    });
    expect(allocations.length).toBe(1);
    return allocations[0]!.warehouseId;
  }

  it('orders.business_id.prefix + .suffix wrap the generated order number', async () => {
    await addToCart(1);
    const order = await withChannelValue(SETTING.businessIdPrefix, 'CH-', async () =>
      withChannelValue(SETTING.businessIdSuffix, '-Z', async () => placeOk()),
    );
    expect(order.businessId.startsWith('CH-')).toBe(true);
    expect(order.businessId.endsWith('-Z')).toBe(true);
    // The middle is the drawn sequence — asserted so a business id that were
    // *only* the affixes could not pass.
    expect(order.businessId.slice(3, -2)).toMatch(/\d/);
  });

  it('orders.min_order_value refuses a cart below the channel minimum', async () => {
    await addToCart(1);
    const refused = await withChannelValue(SETTING.minOrderValue, 10_000, async () => place());
    expect(refused.statusCode).toBe(422);
    expect(
      (refused.body as { error: { details?: { code?: string; minimum?: number } } }).error.details,
    ).toMatchObject({ code: 'order_below_minimum', minimum: 10_000 });

    // Same cart, minimum back at the manifest default: it goes through. Without
    // this the case would also pass against a placement broken for any reason.
    const accepted = await place();
    expect(accepted.statusCode).toBe(201);
  });

  it('orders.reorder_enabled refuses a reorder on the channel that switched it off', async () => {
    await addToCart(1);
    const order = await placeOk();

    const refused = await withChannelValue(SETTING.reorderEnabled, false, async () =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/reorder`,
        cookies: COOKIE,
      }),
    );
    expect(refused.statusCode).toBe(403);
    expect(
      (refused.json() as { error: { details?: { code?: string } } }).error.details?.code,
    ).toBe('reorder_disabled');

    const allowed = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/reorder`,
      cookies: COOKIE,
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('orders.confirmation_recipients copies the channel recipients on the confirmation', async () => {
    const recipient = 'channel-ops@example.test';
    await addToCart(1);
    const before = mailer.sent.length;
    await withChannelValue(SETTING.confirmationRecipients, [recipient], async () => placeOk());
    const recipients = mailer.sent.slice(before).map((m) => m.to);
    expect(recipients).toContain(recipient);

    // And only while it is configured — the control that makes the assertion
    // above about the setting rather than about the mailer.
    await addToCart(1);
    const between = mailer.sent.length;
    await placeOk();
    expect(mailer.sent.slice(between).map((m) => m.to)).not.toContain(recipient);
  });

  it('inventory.fulfilment_strategy moves the allocation to the channel-configured warehouse', async () => {
    await addToCart(1);
    const baseline = await placeOk();
    expect(await allocatedWarehouse(baseline.id)).toBe(DEFAULT_WAREHOUSE_ID);

    await addToCart(1);
    const configured = await withChannelValue(
      SETTING.fulfilmentStrategy,
      'highest_stock_first',
      async () => placeOk(),
    );
    expect(await allocatedWarehouse(configured.id)).toBe(SECONDARY_WAREHOUSE_ID);
  });

  it('inventory.fulfilment_strategy_warehouse_order drives the defined_order strategy', async () => {
    await addToCart(1);
    const order = await withChannelValue(SETTING.fulfilmentStrategy, 'defined_order', async () =>
      withChannelValue(SETTING.fulfilmentWarehouseOrder, [SECONDARY_WAREHOUSE_ID, DEFAULT_WAREHOUSE_ID], async () =>
        placeOk(),
      ),
    );
    // The secondary is neither the channel default nor the highest-sorted
    // assignment, so only the configured order can put the allocation there.
    expect(await allocatedWarehouse(order.id)).toBe(SECONDARY_WAREHOUSE_ID);
  });
});
