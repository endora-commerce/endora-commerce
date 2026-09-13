import { Cart, CartItem, Invoice } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

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

import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';


import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';
import { Order } from '../../helpers/package-entities.js';


/**
 * Feature 080, T048 — the three seams `placeOrder` used to spell with another
 * module's entity class, exercised end to end against a live database.
 *
 * The conversion's whole claim is that **nothing about the transaction moved**:
 * the basket read, the basket completion and the proforma still run on the
 * placement `EntityManager`, so the constraints that hold them
 * (`carts_completed_order_fk`, `invoices_order_fk`) are satisfiable and a
 * placement that fails takes every one of those writes back with it. That is a
 * property of the *database*, so it cannot be asserted with doubles, and it is
 * the one `check:transaction-context` exists because somebody lost:
 * `PromotionUsageService.finalize` incremented its counters on a pooled
 * connection, so a cap hit rolled the order back and left a redemption row
 * pointing at an order that never existed.
 *
 * The cases run in one file and in order because they share the harness's
 * single seeded cart: the atomicity case must leave it untouched, which is
 * exactly what it asserts, so the degrade case that follows still has a basket
 * to place.
 */
describe('placeOrder — the T048 apply ports, against a live transaction', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
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
   * The atomicity proof, and the reason it fails *late*: the two existing
   * failure tests throw before any of these ports is reached, so they say
   * nothing about whether a port's own statements are inside the caller's
   * transaction. Here the real `invoices` port has already written a row and
   * the real `carts` port has already emptied the basket when the placement
   * throws — and both must be gone afterwards, along with the order.
   *
   * A port that had taken its own `EntityManager` — the natural shape, and the
   * one D-169 forbids for exactly this seam — would leave the proforma
   * committed against an order that never existed, and the buyer's basket
   * emptied for a placement that failed.
   */
  it('rolls the proforma and the basket completion back with the placement that failed', async () => {
    const before = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    expect(before).not.toBeNull();
    const linesBefore = await h.em().find(CartItem, { cartId: before!.id });
    expect(linesBefore.length).toBeGreaterThan(0);
    const invoicesBefore = await h.em().count(Invoice, {});

    const real = orderServiceNeighbours(h.em);
    let completionRan = false;
    const service = buildService({
      cartPlacementApply: {
        readActiveForPlacement: (em, ctx) => real.cartPlacementApply.readActiveForPlacement(em, ctx),
        completeForOrder: async (em, input) => {
          // Let the real completion write first: the point is that a *committed*
          // statement would survive, so the failure has to land after one.
          await real.cartPlacementApply.completeForOrder(em, input);
          completionRan = true;
          throw new Error('T048: placement fails after every apply port has written');
        },
      },
    });

    await expect(place(service)).rejects.toThrow(/placement fails after/);
    expect(completionRan).toBe(true);

    // The basket is as the buyer left it: still active, same lines, no pointer.
    h.em().clear();
    const after = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    expect(after).not.toBeNull();
    expect(await h.em().find(CartItem, { cartId: after!.id })).toHaveLength(linesBefore.length);
    expect(after!.completedOrderId ?? null).toBeNull();

    // And the proforma the `invoices` port wrote on that same transaction is
    // gone with it — which is the assertion no double can make.
    expect(await h.em().count(Invoice, {})).toBe(invoicesBefore);
    expect(await h.em().find(Order, { organizationId: TEST_ORGANIZATION_ID })).toHaveLength(0);
  });

  /**
   * The `degrades-without` sentence `orders`' manifest declares for
   * `invoices:invoicePlacementApplyPort`, made real: *"an order is placed
   * without a proforma document; nothing else about the order changes"*.
   *
   * `null` from the accessor is what the composed module hands `placeOrder`
   * when `effectiveState.isPresent('invoices')` says no, so this is the
   * off-state behaviour and not an approximation of it. **It is also the
   * repair**: before T048 this module wrote the row into `invoices`' own table
   * itself, so an operator who had switched invoicing off went on having a
   * document opened by every placement — while the setting's own description
   * told them issuance was off.
   */
  it('places the order and opens no proforma when invoices is not present', async () => {
    const invoicesBefore = await h.em().count(Invoice, {});

    const order = await place(buildService({ invoicePlacementApply: () => null }));

    expect(order.id).toBeTruthy();
    h.em().clear();
    expect(await h.em().count(Invoice, { orderId: order.id })).toBe(0);
    expect(await h.em().count(Invoice, {})).toBe(invoicesBefore);
    // Nothing else about the order changed: the basket was still completed
    // against it, and the order carries its payment next-action as usual.
    const cart = await h.em().findOne(Cart, { completedOrderId: order.id });
    expect(cart?.status).toBe('completed');
    expect(order.nextAction?.kind).toBe('awaiting_transfer');
  });

  /**
   * The other side of the same coin, and the one the port shape makes possible
   * at all: with `carts` absent the seam **fails closed** rather than placing
   * an empty order. `carts` declares `activation.nonDeactivatable`, so an
   * operator cannot reach that state by flipping a control and the manifest
   * carries no deactivation-consequence entry for it — which is why the proof
   * is of the substance at the call site, with the port throwing the error a
   * gated registration throws (the shape D-171's own note prescribes for a
   * locked owner).
   */
  it('refuses the placement, writing nothing, when the basket port`s owner is absent', async () => {
    const invoicesBefore = await h.em().count(Invoice, {});
    const service = buildService({
      cartPlacementApply: {
        readActiveForPlacement: async () => {
          throw new ModuleDisabledError('carts');
        },
        completeForOrder: async () => {
          throw new Error('unreachable: the read refuses first');
        },
      },
    });

    await expect(place(service)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'carts' },
    });

    h.em().clear();
    expect(await h.em().count(Invoice, {})).toBe(invoicesBefore);
  });

  /**
   * D-77's first narrowing, asserted rather than trusted: the seam hands back
   * **published records**, never the owner's managed rows. `tsc` cannot catch a
   * regression here — an ORM entity is structurally assignable to the record
   * type, which is how `custom_fields`' `getById` shipped one across a boundary
   * for a year (!983) — so the identity is checked at run time.
   */
  it('answers the basket read with records, not the managed entities', async () => {
    // A fresh basket: the placement case above consumed the seeded one, which
    // is the behaviour it exists to assert.
    await seedCartForStubCustomer(h.em());
    const em = h.em();
    const managed = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    expect(managed).not.toBeNull();

    const read = await orderServiceNeighbours(h.em).cartPlacementApply.readActiveForPlacement(
      em as EntityManager,
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
    );

    expect(read?.cart.id).toBe(managed!.id);
    expect(read?.cart).not.toBe(managed);
    expect(read?.cart).not.toBeInstanceOf(Cart);
    for (const line of read?.items ?? []) expect(line).not.toBeInstanceOf(CartItem);
  });
});
