import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CartWritePort,
  type CatalogProductReadPort,
  type OrderPlacementPort,
  type OrganizationPermissionPort,
  type PlacedOrderRecord,
  type QuickOrderResolvedDefaults,
} from '@endora-commerce/contracts';
import { OneClickService } from './one-click-service.js';
import type { DefaultPreferenceService } from './default-preference-service.js';

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

/**
 * `specs/170-organization-roles/` (FR-050, R-6) — a permission port answering
 * from a fixed set of held codes. `assert` refuses the way the real port does:
 * `403 ORGANIZATION_PERMISSION_REQUIRED` naming the code.
 */
function permissionsHolding(
  held: readonly string[],
): OrganizationPermissionPort & { calls: string[] } {
  const calls: string[] = [];
  const can = async (_subject: unknown, code: string): Promise<boolean> => {
    calls.push(code);
    return held.includes(code);
  };
  return {
    calls,
    can,
    assert: async (subject, code) => {
      if (!(await can(subject, code))) {
        throw Object.assign(new Error(`permission ${code} required`), {
          statusCode: 403,
          code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
          details: { permission: code },
        });
      }
    },
    isAdministrator: async () => false,
    effective: async () => ({ role: { id: 'role-1', kind: 'custom' }, permissions: [...held] }),
    rolesHolding: async () => [],
  };
}

const ONE_CLICK = 'quick_order.one_click';
const ORDER_WITHOUT_APPROVAL = 'carts.order_without_approval';
/** A member holding both codes one-click needs (FR-050). */
const ALLOW_ALL = permissionsHolding([ONE_CLICK, ORDER_WITHOUT_APPROVAL]);

/**
 * Feature 155 (FR-010, R12.3) — the catalogue read the default quantity comes
 * from. Answers `null` for every id unless given records.
 */
function catalogOf(
  records: Array<{ id: string; type: string; minOrderQuantity: number | null }> = [],
): CatalogProductReadPort {
  return {
    findById: async (id: string) => records.find((r) => r.id === id) ?? null,
  } as unknown as CatalogProductReadPort;
}

/** A resolved request channel: an id, never a code (issue #99). */
const CHANNEL_ID = '4b1f0a2c-8e3d-4a7b-9c11-2f6d5e8a0b34';

describe('OneClickService.eligibility', () => {
  it('is disabled when the setting is off', async () => {
    const svc = new OneClickService(
      prefStub(FULL_DEFAULTS),
      {} as CartWritePort,
      REFUSING_PLACEMENT,
      async () => false,
      catalogOf(),
      ALLOW_ALL,
    );
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({
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
      catalogOf(),
      ALLOW_ALL,
    );
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({
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
      catalogOf(),
      ALLOW_ALL,
    );
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: true, reason: null });
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
      catalogOf(),
      ALLOW_ALL,
    );

    await svc.eligibility(ctx, CHANNEL_ID);
    expect(resolveOneClickEnabled).toHaveBeenCalledWith(CHANNEL_ID);

    await svc.eligibility(ctx, null);
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
      catalogOf(),
      ALLOW_ALL,
    );
    await expect(svc.place(ctx, { productId: 'p-1' }, CHANNEL_ID)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('writes the product into a working basket and places the order from it with the resolved defaults (#169)', async () => {
    const replaceItemsForCustomer = vi.fn(async () => undefined);
    const addItems = vi.fn(async () => ({ cart: { id: 'working-1', status: 'working' }, items: [], outcomes: [] }));
    const placeOrder = vi.fn(
      async () => ({ id: 'o-1', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
    );
    const cart = { replaceItemsForCustomer, addItems } as unknown as CartWritePort;
    const placement = { placeOrder } as unknown as OrderPlacementPort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true, catalogOf(), ALLOW_ALL);
    const order = await svc.place(
      ctx,
      { productId: 'p-1', quantity: 2, idempotencyKey: 'k-1' },
      CHANNEL_ID,
      { language: 'pl' },
    );

    expect(order.id).toBe('o-1');
    // Issue #169 — the buyer's active basket is never re-seeded: the line goes
    // into a working basket, and the order is placed from that one.
    expect(replaceItemsForCustomer).not.toHaveBeenCalled();
    // Feature 155 (D3/D4) — both refusals name the product in the response's language.
    // The basket is the one of the channel the order is placed on
    // (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §1).
    expect(addItems).toHaveBeenCalledWith(
      { customer: { ...ctx, salesChannelId: CHANNEL_ID } },
      [{ productId: 'p-1', quantity: 2 }],
      {
        onLineError: 'throw',
        onBelowMinimum: 'throw',
        workingBasket: true,
        language: 'pl',
      },
    );
    expect(placeOrder).toHaveBeenCalledWith(
      ctx,
      {
        deliveryAddressId: 'ship-1',
        billingAddressId: 'bill-1',
        deliveryMethodId: 'del-1',
        paymentMethodId: 'pay-1',
        salesChannelId: CHANNEL_ID,
        idempotencyKey: 'k-1',
      },
      { language: 'pl', workingBasketId: 'working-1' },
    );
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
      addItems: vi.fn(async () => ({ cart: {}, items: [], outcomes: [] })),
    } as unknown as CartWritePort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true, catalogOf(), ALLOW_ALL);
    const order = await svc.place(ctx, { productId: 'p-1' }, CHANNEL_ID);

    expect(order.nextAction).toEqual(nextAction);
  });

  /**
   * The basket and the order are one channel's. One-click used to take a
   * `null` channel and place on whatever the order fell back to, while the
   * basket it filled was the system default's whatever the request; a basket
   * belongs to its channel now, so the channel is required and both use it.
   */
  it('fills the basket of the channel it places the order on', async () => {
    const placeOrder = vi.fn(
      async (_ctx: unknown, _req: Record<string, unknown>) =>
        ({ id: 'o-2', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
    );
    const addItems = vi.fn(async () => ({ cart: {}, items: [], outcomes: [] }));
    const cart = {
      addItems,
    } as unknown as CartWritePort;
    const placement = { placeOrder } as unknown as OrderPlacementPort;

    const svc = new OneClickService(prefStub(FULL_DEFAULTS), cart, placement, async () => true, catalogOf(), ALLOW_ALL);
    await svc.place(ctx, { productId: 'p-1' }, CHANNEL_ID);

    expect((addItems.mock.calls[0] as unknown[])[0]).toEqual({
      customer: { ...ctx, salesChannelId: CHANNEL_ID },
    });
    expect(placeOrder.mock.calls[0]![1]).toMatchObject({ salesChannelId: CHANNEL_ID });
  });

  /**
   * Feature 155 (FR-010, R12.3, analyze F14) — without a quantity, one-click
   * orders the product's pieces minimum, only for the types the rule applies to.
   */
  describe('default quantity (feature 155)', () => {
    async function quantityPlaced(
      product: { id: string; type: string; minOrderQuantity: number | null } | null,
      quantity?: number,
    ): Promise<number> {
      const addItems = vi.fn(async () => ({ cart: {}, items: [], outcomes: [] }));
      const cart = { addItems } as unknown as CartWritePort;
      const placement = {
        placeOrder: async () => ({ id: 'o-1', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
      } as unknown as OrderPlacementPort;
      const svc = new OneClickService(
        prefStub(FULL_DEFAULTS),
        cart,
        placement,
        async () => true,
        catalogOf(product ? [product] : []),
        ALLOW_ALL,
      );
      await svc.place(
        ctx,
        { productId: product?.id ?? 'p-unknown', ...(quantity !== undefined ? { quantity } : {}) },
        CHANNEL_ID,
      );
      const lines = (addItems.mock.calls[0] as unknown as [unknown, Array<{ quantity: number }>])[1];
      return lines[0]!.quantity;
    }

    it('uses the minimum of a simple product', async () => {
      expect(await quantityPlaced({ id: 'p-a', type: 'simple', minOrderQuantity: 10 })).toBe(10);
    });

    it('uses the minimum of a configurable product', async () => {
      expect(await quantityPlaced({ id: 'p-c', type: 'configurable', minOrderQuantity: 6 })).toBe(6);
    });

    it('uses 1 for a bundle with a stored minimum', async () => {
      expect(await quantityPlaced({ id: 'p-b', type: 'bundle', minOrderQuantity: 10 })).toBe(1);
    });

    it('uses 1 for a product with no minimum', async () => {
      expect(await quantityPlaced({ id: 'p-d', type: 'simple', minOrderQuantity: null })).toBe(1);
    });

    it('uses 1 for an unknown product and leaves the refusal to the add path', async () => {
      expect(await quantityPlaced(null)).toBe(1);
    });

    it('passes an explicit quantity through, below the minimum included', async () => {
      expect(await quantityPlaced({ id: 'p-a', type: 'simple', minOrderQuantity: 10 }, 5)).toBe(5);
    });
  });
});

/**
 * `specs/170-organization-roles/` WP-06 (T084; FR-050, US 4.1–4.3, R-6, owner
 * rulings OR-1, OR-6, PR-8) — one-click is a permission of its own, and it also
 * needs *Place orders without approval*: the two codes are judged in that
 * order, before the setting and the defaults, by the eligibility answer and by
 * the placement alike. Issue #653: a member whose cart needs approval could buy
 * with one click and bypass it.
 */
describe('OneClickService — organization permissions (FR-050)', () => {
  function service(
    permissions: OrganizationPermissionPort,
    overrides: { cart?: CartWritePort; placement?: OrderPlacementPort; enabled?: () => Promise<boolean> } = {},
  ): OneClickService {
    return new OneClickService(
      prefStub(FULL_DEFAULTS),
      overrides.cart ?? ({} as CartWritePort),
      overrides.placement ?? REFUSING_PLACEMENT,
      overrides.enabled ?? (async () => true),
      catalogOf(),
      permissions,
    );
  }

  it('answers permission_required for a member without quick_order.one_click', async () => {
    const svc = service(permissionsHolding([ORDER_WITHOUT_APPROVAL]));
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: false, reason: 'permission_required' });
  });

  it('answers cart_approval_required for a holder of quick_order.one_click without carts.order_without_approval', async () => {
    const svc = service(permissionsHolding([ONE_CLICK]));
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: false, reason: 'cart_approval_required' });
  });

  it('judges quick_order.one_click first: a member lacking both reads permission_required (PR-8)', async () => {
    const permissions = permissionsHolding([]);
    const svc = service(permissions);
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: false, reason: 'permission_required' });
    expect(permissions.calls[0]).toBe(ONE_CLICK);
  });

  it('judges the permissions before the setting and the defaults', async () => {
    const enabled = vi.fn(async () => false);
    const svc = service(permissionsHolding([ONE_CLICK]), { enabled });
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: false, reason: 'cart_approval_required' });
    expect(enabled).not.toHaveBeenCalled();
  });

  it('judges the member it is asked about — account and Organization', async () => {
    const can = vi.fn(async () => true);
    const permissions = { ...permissionsHolding([]), can };
    await service(permissions).eligibility({ ...ctx, organizationRoleId: 'role-9' }, CHANNEL_ID);
    expect(can).toHaveBeenCalledWith(
      { customerAccountId: 'cust-1', organizationId: 'org-1', organizationRoleId: 'role-9' },
      ONE_CLICK,
    );
  });

  it('is enabled for a holder of both codes when the setting and the defaults allow it', async () => {
    const svc = service(permissionsHolding([ONE_CLICK, ORDER_WITHOUT_APPROVAL]));
    expect(await svc.eligibility(ctx, CHANNEL_ID)).toEqual({ enabled: true, reason: null });
  });

  it.each([
    ['lacking both', ONE_CLICK, [] as string[]],
    ['lacking quick_order.one_click', ONE_CLICK, [ORDER_WITHOUT_APPROVAL]],
    ['lacking carts.order_without_approval', ORDER_WITHOUT_APPROVAL, [ONE_CLICK]],
  ])('refuses placement for a member %s with 403 naming %s, before any basket write', async (_who, missing, held) => {
    const addItems = vi.fn(async () => {
      throw new Error('the basket must not be written');
    });
    const replaceItemsForCustomer = vi.fn(async () => {
      throw new Error('the basket must not be written');
    });
    const cart = { addItems, replaceItemsForCustomer } as unknown as CartWritePort;
    const svc = service(permissionsHolding(held), { cart });
    await expect(svc.place(ctx, { productId: 'p-1', quantity: 1 }, CHANNEL_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
      details: { permission: missing },
    });
    expect(addItems).not.toHaveBeenCalled();
    expect(replaceItemsForCustomer).not.toHaveBeenCalled();
  });

  it('places as today for a holder of both codes', async () => {
    const addItems = vi.fn(async () => ({ cart: { id: 'working-1' }, items: [], outcomes: [] }));
    const placeOrder = vi.fn(
      async () => ({ id: 'o-1', status: 'new', nextAction: null }) as unknown as PlacedOrderRecord,
    );
    const svc = service(permissionsHolding([ONE_CLICK, ORDER_WITHOUT_APPROVAL]), {
      cart: { addItems } as unknown as CartWritePort,
      placement: { placeOrder } as unknown as OrderPlacementPort,
    });
    const order = await svc.place(ctx, { productId: 'p-1', quantity: 1 }, CHANNEL_ID);
    expect(order.id).toBe('o-1');
    expect(addItems).toHaveBeenCalledTimes(1);
  });
});
