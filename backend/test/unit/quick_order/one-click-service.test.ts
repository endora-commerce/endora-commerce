import { describe, expect, it, vi } from 'vitest';
import type {
  CartWritePort,
  OrderPlacementPort,
  PlacedOrderRecord,
  QuickOrderResolvedDefaults,
} from '@b2b/contracts';
import { OneClickService } from '../../../src/modules/quick_order/services/one-click-service.js';
import type { DefaultPreferenceService } from '../../../src/modules/quick_order/services/default-preference-service.js';

/**
 * Moved here from `src/modules/quick_order/services/` by feature 075's cut: a
 * test file under `src/` is in the boundary check's scope (spec.md, Edge
 * Cases), and this one named `carts`' and `orders`' internals to build its
 * stubs. Under `test/` it names the two published ports instead, which is also
 * what the service now takes.
 */

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

/** A placement port nothing may reach — the eligibility cases must not place. */
const REFUSING_PLACEMENT: OrderPlacementPort = {
  placeOrder: async () => {
    throw new Error('placeOrder must not be reached when the buy is not eligible');
  },
};

const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1' };

/** A resolved request channel: an id, never a code (issue #99). */
const CHANNEL_ID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';

describe('OneClickService.eligibility', () => {
  it('is disabled when the setting is off', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      async () => false,
    );
    expect(await svc.eligibility('cust-1', CHANNEL_ID)).toEqual({
      enabled: false,
      reason: 'setting_disabled',
    });
  });

  it('is disabled when a default is missing', async () => {
    const svc = new OneClickService(
      prefStub({ ...FULL_DEFAULTS, paymentMethodId: null }),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      async () => true,
    );
    expect(await svc.eligibility('cust-1', CHANNEL_ID)).toEqual({
      enabled: false,
      reason: 'missing_defaults',
    });
  });

  it('is enabled when the setting is on and all four defaults are present', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      async () => true,
    );
    expect(await svc.eligibility('cust-1', CHANNEL_ID)).toEqual({ enabled: true, reason: null });
  });

  /**
   * The regression this file used to encode (issue #99). Every construction
   * here passed a fifth argument production never passed, so the suite ran
   * against `'default'` — a channel *code* — while production read the same
   * code, tripped the settings seam guard and reported `setting_disabled` on
   * every deployment. The service takes the channel per call, so the read is
   * made with whatever the resolver put on the request.
   */
  it('reads the setting against the channel it is given, not a compiled-in one', async () => {
    const resolveOneClickEnabled = vi.fn(async () => true);
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      resolveOneClickEnabled,
    );

    await svc.eligibility('cust-1', CHANNEL_ID);
    expect(resolveOneClickEnabled).toHaveBeenCalledWith(CHANNEL_ID);

    await svc.eligibility('cust-1', null);
    expect(resolveOneClickEnabled).toHaveBeenLastCalledWith(null);
  });
});

describe('OneClickService.place', () => {
  it('rejects when not eligible', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      async () => false,
    );
    await expect(svc.place(ctx, { productId: 'p-1' }, CHANNEL_ID)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('clears the cart, adds the product, and places the order from resolved defaults', async () => {
    const clearForCustomer = vi.fn(async () => undefined);
    const addItem = vi.fn(async () => ({ cart: {}, items: [] }));
    const placeOrder = vi.fn(
      async () => ({ id: 'o-1', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
    );
    const cart = { clearForCustomer, addItem } as unknown as CartWritePort;
    const placement = { placeOrder } as unknown as OrderPlacementPort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true);
    const order = await svc.place(
      ctx,
      { productId: 'p-1', quantity: 2, idempotencyKey: 'k-1' },
      CHANNEL_ID,
    );

    expect(order.id).toBe('o-1');
    expect(clearForCustomer).toHaveBeenCalledWith(ctx);
    expect(addItem).toHaveBeenCalledWith({ customer: ctx }, { productId: 'p-1', quantity: 2 });
    expect(placeOrder).toHaveBeenCalledWith(ctx, {
      deliveryAddressId: 'ship-1',
      billingAddressId: 'bill-1',
      deliveryMethodId: 'del-1',
      paymentMethodId: 'pay-1',
      salesChannelId: CHANNEL_ID,
      idempotencyKey: 'k-1',
    });
  });

  /**
   * The payment routing survives the port (feature 075). `OrderPlacementPort`
   * was published returning `OrderRecord`, which has no `nextAction` — a read
   * of an order never has one, because the column is virtual — so cutting onto
   * it as published would have dropped the gateway redirect from the one-click
   * reply. `PlacedOrderRecord` is what the port answers with now, and this is
   * the assertion that says so.
   */
  it('carries the placement nextAction back to the caller', async () => {
    const nextAction = { kind: 'redirect', url: 'https://gateway.example/pay/abc' };
    const placement = {
      placeOrder: async () =>
        ({ id: 'o-3', status: 'new', nextAction }) as unknown as PlacedOrderRecord,
    } as unknown as OrderPlacementPort;
    const cart = {
      clearForCustomer: vi.fn(async () => undefined),
      addItem: vi.fn(async () => ({ cart: {}, items: [] })),
    } as unknown as CartWritePort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true);
    const order = await svc.place(ctx, { productId: 'p-1' }, CHANNEL_ID);

    expect(order.nextAction).toEqual(nextAction);
  });

  /** No request channel ⇒ no `salesChannelId` key at all, never an invented one. */
  it('omits the channel entirely when there is none to record', async () => {
    const placeOrder = vi.fn(
      async (_ctx: unknown, _req: Record<string, unknown>) =>
        ({ id: 'o-2', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
    );
    const cart = {
      clearForCustomer: vi.fn(async () => undefined),
      addItem: vi.fn(async () => ({ cart: {}, items: [] })),
    } as unknown as CartWritePort;
    const placement = { placeOrder } as unknown as OrderPlacementPort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true);
    await svc.place(ctx, { productId: 'p-1' }, null);

    expect(placeOrder.mock.calls[0]![1]).not.toHaveProperty('salesChannelId');
  });
});
