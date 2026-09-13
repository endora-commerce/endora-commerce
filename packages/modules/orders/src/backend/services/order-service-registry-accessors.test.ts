import { describe, expect, it, vi } from 'vitest';
import type {
  OrderStatusRegistry,
  PaymentAdapterRegistryPort,
  ShippingAdapterRegistryPort,
} from '@endora-commerce/contracts';
import { OrderService } from './order-service.js';
import type { OrderEventBus, OrderServiceNeighbourPorts } from './order-service.js';

/**
 * The three registries this module reads from `payment_methods` and
 * `delivery_methods` are held as accessors and resolved per read (D-228).
 *
 * Two defects sat under one line of wiring. `orders`' plugin body invoked
 * `options.paymentAdapterRegistry()` and its two siblings at the top of the
 * returned Fastify plugin, which runs under `avvio` while routes are being
 * registered — so the container was asked before any request existed. A
 * composition that never installed the owner therefore threw
 * `AwilixResolutionError` at wiring time rather than degrading, which is what
 * killed the first scaffolded instance to reach route registration; and the
 * one answer it did get was then frozen into `OrderService`, so an operator
 * switching the owner off afterwards left placement dispatching through a
 * table this module had already captured — the fail-open D-38b refuses, and
 * one `captured-registration` cannot see because that rail keys on the
 * lexical read.
 *
 * All three names are declared `degrades-without` in this module's manifest,
 * whose definition already obliges the reader to check presence before it
 * reads. These assertions are about the *holding*: that nothing is resolved
 * when the service is built, and that the answer is the container's at the
 * moment of the read. Whether the probe itself is wired is `backend.ts`'
 * question and A4's; whether the no-adapter path is right is the placement
 * tests'.
 *
 * The getters are private because the eleven read sites inside the service are
 * deliberately unchanged — `this.paymentAdapters?.get(...)` still reads as a
 * value. The cast below reaches exactly the seam this file is about and
 * nothing else.
 */

type RegistryView = {
  readonly paymentAdapters: PaymentAdapterRegistryPort | undefined;
  readonly orderStatusRegistry: OrderStatusRegistry | undefined;
  readonly shippingAdapters: ShippingAdapterRegistryPort | undefined;
};

const neighbours = {
  customerAccountRead: {},
} as unknown as OrderServiceNeighbourPorts;

const buildService = (paymentDeps: {
  paymentAdapters?: () => PaymentAdapterRegistryPort | null;
  orderStatusRegistry?: () => OrderStatusRegistry | null;
  shippingAdapters?: () => ShippingAdapterRegistryPort | null;
}): RegistryView =>
  new OrderService(
    () => {
      throw new Error('this test resolves no EntityManager');
    },
    {} as unknown as OrderEventBus,
    undefined,
    undefined,
    undefined,
    { neighbours, ...paymentDeps },
  ) as unknown as RegistryView;

describe('OrderService registry accessors', () => {
  it('resolves none of the three while the service is being built', () => {
    const paymentAdapters = vi.fn(() => null);
    const orderStatusRegistry = vi.fn(() => null);
    const shippingAdapters = vi.fn(() => null);

    buildService({ paymentAdapters, orderStatusRegistry, shippingAdapters });

    expect(paymentAdapters).toHaveBeenCalledTimes(0);
    expect(orderStatusRegistry).toHaveBeenCalledTimes(0);
    expect(shippingAdapters).toHaveBeenCalledTimes(0);
  });

  it('survives construction when every accessor throws, as an absent owner does', () => {
    const throwing = () => {
      throw new Error("Could not resolve 'paymentAdapterRegistry'");
    };

    expect(() =>
      buildService({
        paymentAdapters: throwing,
        orderStatusRegistry: throwing,
        shippingAdapters: throwing,
      }),
    ).not.toThrow();
  });

  it('reads the container at the read, so a later answer wins over an earlier one', () => {
    const first = { list: () => ['first'] } as unknown as PaymentAdapterRegistryPort;
    const second = { list: () => ['second'] } as unknown as PaymentAdapterRegistryPort;
    let answer: PaymentAdapterRegistryPort | null = first;

    const service = buildService({ paymentAdapters: () => answer });
    expect(service.paymentAdapters).toBe(first);

    // What a runtime deactivation of `payment_methods` looks like from here.
    answer = null;
    expect(service.paymentAdapters).toBeUndefined();

    answer = second;
    expect(service.paymentAdapters).toBe(second);
  });

  it('reads `null` as the no-registry path an omitted accessor already took', () => {
    const absent = buildService({
      paymentAdapters: () => null,
      orderStatusRegistry: () => null,
      shippingAdapters: () => null,
    });
    const unwired = buildService({});

    expect(absent.paymentAdapters).toBeUndefined();
    expect(absent.orderStatusRegistry).toBeUndefined();
    expect(absent.shippingAdapters).toBeUndefined();
    expect(unwired.paymentAdapters).toBeUndefined();
    expect(unwired.orderStatusRegistry).toBeUndefined();
    expect(unwired.shippingAdapters).toBeUndefined();
  });
});
