import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '@endora-commerce/platform/events';
import {
  OrderService,
  type OrderEventBus,
  type OrderServiceNeighbourPorts,
} from '../../../../packages/modules/orders/dist/backend/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';
import { StockAllocation } from '../../helpers/package-entities.js';
import { StockLevel } from '../../helpers/package-entities.js';
import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 080, T048 — the stock reservation seam, exercised against a live
 * transaction (D-169).
 *
 * `placeOrder` held `inventory`'s `StockLevel` and `StockAllocation` classes
 * until this conversion, statically **and** through an `await import()` inside
 * `releaseAllocations`, and did the `FOR UPDATE` read, the `reserved` increment,
 * the allocation insert and the release loop itself. D-168 leaves a packaged
 * `inventory` no entity class for `orders` to name, so the reach had to go
 * before that module moves.
 *
 * The conversion's whole claim is that **nothing about the transaction moved**:
 * every one of those statements still runs on placement's own `EntityManager`,
 * so `stock_allocations_order_item_fk` stays satisfiable and the
 * `PESSIMISTIC_WRITE` on `stock_levels` is still held until the order commits.
 * That is a property of the *database* and cannot be asserted with doubles. It
 * is also the property `check:transaction-context` exists because somebody
 * lost — `PromotionUsageService.finalize` incremented its counters on a pooled
 * connection, so a cap hit rolled the order back and left a redemption row
 * pointing at an order that never existed. Stock is the same hazard with worse
 * consequences: a `reserved` increment that survives a failed placement is
 * inventory nobody can sell and nobody can find.
 *
 * The `degrades-without` half — an operator switching `inventory` off — is
 * driven through the composed HTTP route in
 * `place-order-inventory-off.test.ts`, which is where a presence accessor that
 * lives in `orders/backend.ts` can actually be flipped (issue #141). This file
 * asserts what that one cannot: that the port's own statements are inside the
 * caller's transaction, and that what crosses the seam is records rather than
 * `inventory`'s managed rows.
 */
describe('placeOrder — the stock reservation apply port, against a live transaction', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function buildService(over: Partial<OrderServiceNeighbourPorts> = {}): OrderService {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: { ...orderServiceNeighbours(h.em), ...over },
      resolveTaxRate: async () => 0.23,
      paymentAdapters: () => registry,
      orderStatusRegistry: () => new EnumOrderStatusRegistry(),
    });
  }

  const place = (service: OrderService) =>
    service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );

  /**
   * Read straight out of the connection rather than through the ORM, so the
   * figure is what is **committed** and not what this test's identity map
   * happens to be holding.
   */
  const reservedForSeedProduct = async (): Promise<number> => {
    const rows = (await h.em().getConnection().execute(
      `select coalesce(sum("reserved"), 0)::int as "reserved"
         from "stock_levels" where "product_id" = ?`,
      [SEED_PRODUCT_101_ID],
    )) as Array<{ reserved: number }>;
    return rows[0]!.reserved;
  };

  const allocationCount = async (): Promise<number> => {
    const rows = (await h.em().getConnection().execute(
      `select count(*)::int as "count" from "stock_allocations"`,
    )) as Array<{ count: number }>;
    return rows[0]!.count;
  };

  /**
   * The atomicity proof, and the reason it fails *late*: every existing
   * placement-failure test throws before the reservation is reached, so none of
   * them says anything about whether the port's own statements are inside the
   * caller's transaction. Here the real port has already locked the stock row,
   * incremented `reserved` and inserted the allocation rows when the placement
   * throws — and every one of those must be gone afterwards, along with the
   * order.
   *
   * A port that had taken its own `EntityManager` — the natural shape, and the
   * one D-169 forbids for exactly this seam — fails this two ways, and both
   * were **measured** rather than assumed, by a negative control built against
   * this file and then deleted:
   *
   *   - the allocation insert cannot satisfy `stock_allocations_order_item_fk`
   *     against order items its own transaction cannot see —
   *     *"insert or update on table \"stock_allocations\" violates foreign key
   *     constraint \"stock_allocations_order_item_fk\" … Key (order_item_id) is
   *     not present in table \"order_items\""*;
   *   - and with the allocation write put back on the caller's transaction so
   *     the placement reaches its seeded failure, the `reserved` increment
   *     commits and **survives the rollback**: `expected 2 to be +0`, two units
   *     of stock reserved for an order that never existed.
   *
   * Both are what this case asserts the absence of.
   */
  it('rolls the reservation and the allocation rows back with the placement that failed', async () => {
    await seedCartForStubCustomer(h.em());
    const reservedBefore = await reservedForSeedProduct();
    const allocationsBefore = await allocationCount();

    const real = orderServiceNeighbours(h.em).inventory();
    if (real === null) throw new Error('the rig must hand back a live `inventory` here');

    let allocationsWritten = false;
    const service = buildService({
      inventory: () => ({
        stockRead: real.stockRead,
        planning: real.planning,
        reservationApply: {
          lockAvailabilityForPlacement: (em, input) =>
            real.reservationApply.lockAvailabilityForPlacement(em, input),
          reserveForPlacement: (em, input) => real.reservationApply.reserveForPlacement(em, input),
          releaseForOrderItems: (em, input) =>
            real.reservationApply.releaseForOrderItems(em, input),
          recordAllocationsForOrderItems: async (em, input) => {
            // Let the real write land first: the point is that a *committed*
            // statement would survive, so the failure has to land after one.
            await real.reservationApply.recordAllocationsForOrderItems(em, input);
            allocationsWritten = true;
            throw new Error('T048: placement fails after the reservation port has written');
          },
        },
      }),
    });

    await expect(place(service)).rejects.toThrow(/placement fails after/);
    expect(allocationsWritten).toBe(true);

    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore);
    expect(await allocationCount()).toBe(allocationsBefore);
    expect(await h.em().find(Order, { organizationId: TEST_ORGANIZATION_ID })).toHaveLength(0);
  });

  /**
   * The declared degrade, at the seam rather than at the route: `null` from the
   * accessor is what the composed module hands `placeOrder` when
   * `effectiveState.isPresent('inventory')` says no, and the whole reservation
   * block — the port included — is skipped rather than half-run.
   */
  it('places the order and reserves nothing when inventory is not present', async () => {
    await seedCartForStubCustomer(h.em());
    const reservedBefore = await reservedForSeedProduct();
    const allocationsBefore = await allocationCount();

    const order = await place(buildService({ inventory: () => null }));

    expect(order.id).toBeTruthy();
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore);
    expect(await allocationCount()).toBe(allocationsBefore);
  });

  /**
   * The release loop, which was the pair of `await import()` calls the header
   * comment above the static imports wrongly claimed were gone. It runs in its
   * own transaction — `releaseAllocations` opens one — so the port takes that
   * transaction's `EntityManager` exactly as placement hands it its own.
   */
  it('releases what placement reserved, and is idempotent', async () => {
    await seedCartForStubCustomer(h.em());
    const reservedBefore = await reservedForSeedProduct();

    const service = buildService();
    const order = await place(service);
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore + 2);

    expect(await service.releaseAllocations(order.id)).toEqual({ released: 1 });
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore);

    // `released_at IS NULL` is what makes the second run a no-op rather than a
    // second decrement.
    expect(await service.releaseAllocations(order.id)).toEqual({ released: 0 });
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore);
  });

  /**
   * The off-state answer for the release half, which the conversion forces and
   * the reservation half has had since D-94.4: with `inventory` absent the
   * release is skipped whole rather than writing that module's two tables under
   * an operator who has switched it off (issue #188's shape). The allocation
   * survives untouched — off is non-destructive — and a release run once the
   * module is back releases it.
   */
  it('releases nothing while inventory is absent, and releases it once restored', async () => {
    await seedCartForStubCustomer(h.em());
    const reservedBefore = await reservedForSeedProduct();

    const order = await place(buildService());
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore + 2);

    const whileOff = buildService({ inventory: () => null });
    expect(await whileOff.releaseAllocations(order.id)).toEqual({ released: 0 });
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore + 2);

    expect(await buildService().releaseAllocations(order.id)).toEqual({ released: 1 });
    h.em().clear();
    expect(await reservedForSeedProduct()).toBe(reservedBefore);
  });

  /**
   * D-77's first narrowing, asserted rather than trusted: the seam hands back
   * **published records**, never `inventory`'s managed rows. `tsc` cannot catch
   * a regression here — an ORM entity is structurally assignable to the record
   * type, which is how `custom_fields`' `getById` shipped one across a boundary
   * for a year (!983) — so the identity is checked at run time. An apply port
   * is the highest-risk case for it, because handing something back mid
   * transaction is exactly what it is for.
   */
  it('answers the locked availability with records, not the managed stock rows', async () => {
    const real = orderServiceNeighbours(h.em).inventory();
    if (real === null) throw new Error('the rig must hand back a live `inventory` here');

    const channelRows = (await h.em().getConnection().execute(
      `select "id" from "sales_channels" where "system_default" = true limit 1`,
    )) as Array<{ id: string }>;
    const warehouses = await real.stockRead.listChannelWarehouses(channelRows[0]!.id);
    expect(warehouses.length).toBeGreaterThan(0);

    const em = h.em();
    await em.transactional(async (tx) => {
      const snapshot = await real.reservationApply.lockAvailabilityForPlacement(
        tx as EntityManager,
        {
          productId: SEED_PRODUCT_101_ID,
          variantId: null,
          warehouseIds: warehouses.map((w) => w.warehouseId),
        },
      );
      expect(snapshot.length).toBe(warehouses.length);
      for (const row of snapshot) {
        expect(row).not.toBeInstanceOf(StockLevel);
        expect(row).not.toBeInstanceOf(StockAllocation);
        expect(Object.keys(row).sort()).toEqual(['available', 'warehouseId']);
      }
      // The managed row the snapshot was derived from is a different object:
      // a hand-back would make these the same reference.
      const managed = await tx.find(StockLevel, { productId: SEED_PRODUCT_101_ID });
      for (const row of snapshot) {
        for (const m of managed) expect(row as unknown).not.toBe(m);
      }
    });
  });
});
