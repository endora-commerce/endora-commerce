import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #188 / D-94.4 — placement reserves nothing while `inventory` is off.
 *
 * The defect this closes: `inventory` appeared **nowhere** in
 * `orders/manifest.ts` while `placeOrder` wrote two of its tables. The reach
 * was four `await import('../../inventory/…')` calls inside the method body
 * plus a knex join over `warehouse_channel_assignments` and `warehouses`, so
 * there was no port, no gate and no declaration — an operator who switched
 * `inventory` off lost the stock screens and the storefront figure and kept
 * every `stock_levels` lock, every `reserved` increment and every
 * `stock_allocations` insert underneath them. The deactivation-consequence
 * ledger could not report it either: that ledger classifies **port** edges, and
 * this was not one.
 *
 * `orders` now declares `inventory` `degrades-without` with
 * `whenAbsent: 'orders are placed without reserving stock'`, and this file is
 * what that declaration is held to. It drives the **composed** service through
 * the HTTP route on purpose: the presence accessor lives in `orders/backend.ts`,
 * so a hand-built `OrderService` with live neighbour ports would answer the same
 * in both states and the flip would go inert (issue #141).
 */
describe('placeOrder with `inventory` switched off (issue #188, D-94.4)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * The placed order's id, read out of the envelope rather than off the root of
   * the body. The first draft of this file read `body.id`, which is
   * `undefined` for `{ data: … }` — and an `undefined` order id makes the
   * "reserved nothing" assertion below count allocations for no order and pass
   * by accident. `statusCode` is returned beside it so a non-201 is reported as
   * a status rather than as a missing id.
   */
  const place = async (): Promise<{ statusCode: number; orderId: string | null }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const body = res.json() as { data?: { id?: string } };
    return { statusCode: res.statusCode, orderId: body.data?.id ?? null };
  };

  const reservedForSeedProduct = async (): Promise<number> => {
    const rows = (await h.em().getConnection().execute(
      `select coalesce(sum("reserved"), 0)::int as "reserved"
         from "stock_levels" where "product_id" = ?`,
      [SEED_PRODUCT_101_ID],
    )) as Array<{ reserved: number }>;
    return rows[0]!.reserved;
  };

  const allocationCountFor = async (orderId: string): Promise<number> => {
    const rows = (await h.em().getConnection().execute(
      `select count(*)::int as "count"
         from "stock_allocations" a
         join "order_items" oi on oi."id" = a."order_item_id"
        where oi."order_id" = ?`,
      [orderId],
    )) as Array<{ count: number }>;
    return rows[0]!.count;
  };

  it('places the order, reserves nothing, and reserves again once restored', async () => {
    await seedCartForStubCustomer(h.em());
    const reservedBefore = await reservedForSeedProduct();

    const offPlacement = await withModuleOff('inventory', 'deactivated', place);

    // The order is taken. That is the declared degrade: `orders` is
    // non-deactivatable and the platform keeps recording transactions, so a
    // refusal here would be the wrong answer and `dependencies` would be the
    // wrong declaration.
    expect(offPlacement.statusCode).toBe(201);
    expect(offPlacement.orderId).not.toBeNull();
    const offOrderId = offPlacement.orderId!;

    // …and nothing was reserved for it. Both halves matter: the allocation
    // rows are the visible artefact, the counter is the one that was silently
    // drifting.
    expect(await allocationCountFor(offOrderId)).toBe(0);
    expect(await reservedForSeedProduct()).toBe(reservedBefore);

    // Full restoration — the same placement against the same product reserves
    // exactly as it always did.
    await seedCartForStubCustomer(h.em());
    const onPlacement = await place();
    expect(onPlacement.statusCode).toBe(201);
    expect(onPlacement.orderId).not.toBeNull();
    const onOrderId = onPlacement.orderId!;

    expect(await allocationCountFor(onOrderId)).toBeGreaterThan(0);
    // `seedCartForStubCustomer` puts two units of the seeded product in the
    // basket, so the counter moves by two.
    expect(await reservedForSeedProduct()).toBe(reservedBefore + 2);
  });
});
