import { describe, expect, it, vi } from 'vitest';
import type { QuickOrderResolvedDefaults } from '@b2b/contracts';
import { OneClickService } from './one-click-service.js';
import type { DefaultPreferenceService } from './default-preference-service.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { OrderService } from '../../orders/services/order-service.js';
import type { Order } from '../../orders/entities/order.entity.js';

const FULL_DEFAULTS: QuickOrderResolvedDefaults = {
  paymentMethodId: 'pay-1',
  deliveryMethodId: 'del-1',
  billingAddressId: 'bill-1',
  shippingAddressId: 'ship-1',
  source: { payment: 'customer', delivery: 'customer', billing: 'customer', shipping: 'customer' },
};

function prefStub(defaults: QuickOrderResolvedDefaults): DefaultPreferenceService {
  return { resolveForCustomer: async () => defaults } as unknown as DefaultPreferenceService;
}

const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1' };

describe('OneClickService.eligibility', () => {
  it('is disabled when the setting is off', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartService,
      () => null,
      async () => false,
    );
    expect(await svc.eligibility('cust-1')).toEqual({ enabled: false, reason: 'setting_disabled' });
  });

  it('is disabled when a default is missing', async () => {
    const svc = new OneClickService(
      prefStub({ ...FULL_DEFAULTS, paymentMethodId: null }),
      {} as CartService,
      () => null,
      async () => true,
    );
    expect(await svc.eligibility('cust-1')).toEqual({ enabled: false, reason: 'missing_defaults' });
  });

  it('is enabled when the setting is on and all four defaults are present', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartService,
      () => null,
      async () => true,
    );
    expect(await svc.eligibility('cust-1')).toEqual({ enabled: true, reason: null });
  });
});

describe('OneClickService.place', () => {
  it('rejects when not eligible', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartService,
      () => null,
      async () => false,
    );
    await expect(svc.place(ctx, { productId: 'p-1' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('clears the cart, adds the product, and places the order from resolved defaults', async () => {
    const clearForCustomer = vi.fn(async () => undefined);
    const addItem = vi.fn(async () => ({ cart: {}, items: [] }));
    const placeOrder = vi.fn(async () => ({ id: 'o-1', status: 'new' }) as unknown as Order);
    const cart = { clearForCustomer, addItem } as unknown as CartService;
    const orderService = { placeOrder } as unknown as OrderService;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, () => orderService, async () => true);
    const order = await svc.place(ctx, { productId: 'p-1', quantity: 2, idempotencyKey: 'k-1' });

    expect(order.id).toBe('o-1');
    expect(clearForCustomer).toHaveBeenCalledWith(ctx);
    expect(addItem).toHaveBeenCalledWith({ customer: ctx }, { productId: 'p-1', quantity: 2 });
    expect(placeOrder).toHaveBeenCalledWith(ctx, {
      deliveryAddressId: 'ship-1',
      billingAddressId: 'bill-1',
      deliveryMethodId: 'del-1',
      paymentMethodId: 'pay-1',
      salesChannelId: 'default',
      idempotencyKey: 'k-1',
    });
  });
});
