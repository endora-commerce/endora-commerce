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
import { SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';

/**
 * Integration — placing an order below available stock is allowed only when
 * BOTH the per-product `backorderEnabled` flag AND the global
 * `inventory.allow_negative_stock` setting are on. Product 102 has no stock
 * row (available = 0); with backorder enabled on the product, the order is
 * rejected (409) while the global gate is off and accepted (201) once it is on.
 */
const ALLOW_NEGATIVE_CODE = 'inventory.allow_negative_stock';
const customerCookie = { b2b_session: 'stub-customer-session' };

async function setGlobalAllowNegative(h: BackendServerHandle, value: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(ALLOW_NEGATIVE_CODE, value, null, {
    actorAdminUserId: '00000000-0000-0000-0000-000000000000',
  });
}

async function addAndPlace(h: BackendServerHandle): Promise<number> {
  const addCart = await h.app.inject({
    method: 'POST',
    url: '/api/v1/cart/items',
    payload: { productId: SEED_PRODUCT_102_ID, quantity: 1 },
    cookies: customerCookie,
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
    cookies: customerCookie,
  });
  return place.statusCode;
}

describe('order placement — backorder gated by global setting', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_102_ID });
    product.backorderEnabled = true;
    product.manageStock = true;
    await em.flush();
  });

  afterAll(async () => {
    const em = h.em();
    const product = await em.findOne(Product, { id: SEED_PRODUCT_102_ID });
    if (product) {
      product.backorderEnabled = false;
      await em.flush();
    }
    const setting = await em.findOne(Setting, { code: ALLOW_NEGATIVE_CODE });
    if (setting) {
      setting.globalValue = null;
      await em.flush();
    }
    for (const row of await em.find(StockLevel, { productId: SEED_PRODUCT_102_ID })) {
      em.remove(row);
    }
    await em.flush();
    await teardownBackendServer(h);
  });

  it('rejects an order below stock when the global gate is off', async () => {
    await setGlobalAllowNegative(h, false);
    expect(await addAndPlace(h)).toBe(409);
  });

  it('accepts the backorder once the global gate is turned on', async () => {
    await setGlobalAllowNegative(h, true);
    expect(await addAndPlace(h)).toBe(201);
  });
});
