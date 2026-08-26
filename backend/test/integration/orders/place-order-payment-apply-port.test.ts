import { Cart } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import {
  seedCreditLimitRaceFixture,
  SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
} from '../../helpers/seed-credit-limit.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '../../../src/events/bus.js';
import {
  OrderService,
  type OrderEventBus,
  type OrderServiceNeighbourPorts,
} from '../../../src/modules/orders/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';
import { PaymentPlacementApplyService } from '../../../src/modules/payments/services/payment-placement-apply-port.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';

/**
 * Feature 080, T048 — the payment row placement opens, exercised against a live
 * transaction (D-169, D-179).
 *
 * `placeOrder` held `payments`' `Payment` class and did the `tx.create` itself
 * until this conversion — the last cross-module entity-class reach in the tree,
 * and the one thing standing between `orders` and `payments` and their
 * packaging. D-168 leaves a packaged `payments` no entity class for `orders` to
 * name, so the reach had to go before either module moves.
 *
 * The conversion's whole claim is that **nothing about the transaction moved**:
 * the row is still written on placement's own `EntityManager`, so
 * `payments_order_fk` (`payments.order_id` -> `orders.id`, `on delete restrict`)
 * stays satisfiable against an order that has not committed, and a placement
 * that fails takes the payment row back with it. That is a property of the
 * *database* and cannot be asserted with doubles — it is the property
 * `check:transaction-context` exists because somebody lost.
 *
 * **And the conversion closes a hole.** `assertPaymentMethodUsable` already
 * refuses a method whose adapter a *registered* module owns while that module is
 * absent, so with `payments` switched off every built-in kind is refused before
 * placement reaches this seam — the shop takes no orders at all, which is what
 * D-179 measured and what this module's `refuses-without` sentence says. What it
 * deliberately tolerates is an adapter **no module ever registered**: that
 * placement ran on, and wrote a row straight into `payments`' own table while an
 * operator had switched `payments` off. That is issue #188's shape, one table
 * over, and the gated port is what refuses it.
 *
 * The cases run in one file and in order because they share the harness's
 * single seeded cart: the two refusing cases must leave it untouched, which is
 * part of what they assert, so the placing case that follows still has a basket.
 */
describe('placeOrder — the payment row apply port, against a live transaction', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function buildService(
    over: Partial<OrderServiceNeighbourPorts> = {},
    adapters: PaymentAdapterRegistry = registryWithBuiltIns(),
  ): OrderService {
    return new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: { ...orderServiceNeighbours(h.em), ...over },
      resolveTaxRate: async () => 0.23,
      paymentAdapters: adapters,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
    });
  }

  function registryWithBuiltIns(): PaymentAdapterRegistry {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return registry;
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
   * The atomicity proof, and the reason it fails *late*: the placement failures
   * the suite already covers throw before this port is reached, so they say
   * nothing about whether the port's own statement is inside the caller's
   * transaction. Here the real `payments` port has already written the row when
   * the placement throws — from the basket completion, which is the last write
   * placement makes — and the row must be gone afterwards, along with the order.
   *
   * A port that had taken its own `EntityManager` — the natural shape, and the
   * one D-169 forbids for exactly this seam — could not even have got that far:
   * `payments_order_fk` is `on delete restrict` against an order the second
   * transaction cannot see.
   */
  it('rolls the payment row back with the placement that failed', async () => {
    const paymentsBefore = await h.em().count(Payment, {});
    const real = orderServiceNeighbours(h.em);
    let opened: string | null = null;

    const service = buildService({
      paymentPlacementApply: {
        openForOrder: async (em, input) => {
          const record = await real.paymentPlacementApply.openForOrder(em, input);
          opened = record.id;
          return record;
        },
        markDeferred: (em, input) => real.paymentPlacementApply.markDeferred(em, input),
      },
      cartPlacementApply: {
        readActiveForPlacement: (em, ctx) => real.cartPlacementApply.readActiveForPlacement(em, ctx),
        completeForOrder: async (em, input) => {
          // Let the real completion write first: the point is that a *committed*
          // statement would survive, so the failure has to land after one.
          await real.cartPlacementApply.completeForOrder(em, input);
          throw new Error('T048: placement fails after the payment row has been written');
        },
      },
    });

    await expect(place(service)).rejects.toThrow(/placement fails after/);
    expect(opened).not.toBeNull();

    h.em().clear();
    expect(await h.em().count(Payment, { id: opened! })).toBe(0);
    expect(await h.em().count(Payment, {})).toBe(paymentsBefore);
    expect(await h.em().find(Order, { organizationId: TEST_ORGANIZATION_ID })).toHaveLength(0);
  });

  /**
   * The hole this conversion closes, and the one state that can reach it.
   *
   * `payments` contributes all four built-in adapter kinds — `bank_transfer`,
   * `pickup`, `credit_limit` and `gateway` — and the registry filters its
   * enumeration on the contributing module's effective state, so with the module
   * off `assertPaymentMethodUsable` finds an owner for the method's adapter and
   * throws before placement reaches this seam. The path that survives is the one
   * that guard deliberately tolerates: an adapter **no module registered**,
   * where it returns rather than refusing, because a deployment may legitimately
   * run an offline method whose adapter is not wired. An empty registry is
   * exactly that state.
   *
   * Before the conversion that placement wrote a row into `payments`' own table
   * with `payments` switched off. Now the gated port refuses it, and — because
   * the refusal happens inside the placement transaction — the order goes with
   * it rather than committing with no payment record.
   */
  it('refuses the placement and writes nothing when the port`s owner is absent', async () => {
    const paymentsBefore = await h.em().count(Payment, {});

    const service = buildService(
      {
        paymentPlacementApply: {
          openForOrder: async () => {
            throw new ModuleDisabledError('payments');
          },
          markDeferred: async () => {
            throw new Error('unreachable: the open refuses first');
          },
        },
      },
      // No adapter for `bank_transfer`, so `assertPaymentMethodUsable` finds no
      // owner and takes its tolerance path — the one route to this seam with
      // `payments` absent.
      new PaymentAdapterRegistry(),
    );

    await expect(place(service)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'payments' },
    });

    h.em().clear();
    expect(await h.em().count(Payment, {})).toBe(paymentsBefore);
    expect(await h.em().find(Order, { organizationId: TEST_ORGANIZATION_ID })).toHaveLength(0);
    // The basket the refused placement read is as the buyer left it.
    const cart = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    expect(cart).not.toBeNull();
    expect(cart!.completedOrderId ?? null).toBeNull();
  });

  /**
   * The unconditional half, which the port had to preserve: the row is the
   * order's record of what is owed, and it is opened for every payment-method
   * kind — a bank transfer exactly as a card.
   */
  it('opens exactly one payment row for the placement, through the port', async () => {
    const order = await place(buildService());

    h.em().clear();
    const rows = await h.em().find(Payment, { orderId: order.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paymentMethodId).toBe(SEED_PAYMENT_METHOD_ID);
    expect(rows[0]!.status).toBe('awaiting_payment');
    expect(Number(rows[0]!.amount)).toBeGreaterThan(0);
    expect(rows[0]!.currency).toBe(order.currency);
  });

  /**
   * D-77's first narrowing, asserted rather than trusted: the seam hands back
   * **published records**, never the owner's managed rows. `tsc` cannot catch a
   * regression here — an ORM entity is structurally assignable to the record
   * type, which is how `custom_fields`' `getById` shipped one across a boundary
   * for a year (!983) — so the identity is checked at run time.
   */
  it('answers with records, not the managed Payment entity', async () => {
    const order = await h.em().findOne(Order, { organizationId: TEST_ORGANIZATION_ID });
    expect(order).not.toBeNull();

    const port = new PaymentPlacementApplyService();
    const opened = await h.em().transactional((tx) =>
      port.openForOrder(tx as EntityManager, {
        orderId: order!.id,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        amount: '12.34',
        currency: 'PLN',
      }),
    );

    const managed = await h.em().findOne(Payment, { id: opened.id });
    expect(managed).not.toBeNull();
    expect(opened.id).toBe(managed!.id);
    expect(opened).not.toBe(managed);
    expect(opened).not.toBeInstanceOf(Payment);

    const deferred = await h
      .em()
      .transactional((tx) => port.markDeferred(tx as EntityManager, { paymentId: opened.id }));
    expect(deferred.status).toBe('deferred');
    expect(deferred).not.toBeInstanceOf(Payment);

    h.em().clear();
    expect((await h.em().findOne(Payment, { id: opened.id }))!.status).toBe('deferred');
  });

  /**
   * The credit-limit branch, end to end through the composed platform: the row
   * is opened unconditionally above the branch and the branch stamps it
   * `deferred` through the port's second method. `orders` set that column on a
   * managed entity of somebody else's table until this conversion; it now asks
   * the owner, in the owner's own vocabulary, on the same transaction.
   *
   * Driven through the HTTP route rather than a hand-built service because that
   * is what proves the container resolves `paymentPlacementApplyPort` at all.
   */
  it('leaves the payment deferred for a credit-limit order, through the composed route', async () => {
    await seedCreditLimitRaceFixture(h.em());

    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
      },
      cookies: { b2b_session: 'stub-customer-session-cl-a' },
    });
    expect(response.statusCode).toBe(201);
    const orderId = (response.json() as { data: { id: string } }).data.id;

    h.em().clear();
    const rows = await h.em().find(Payment, { orderId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('deferred');
  });
});
