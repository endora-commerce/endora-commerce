// Issue #257 — every path that opens a shipment attempt has to ask the carrier.
//
// `openRetry` appended attempt n+1 and contacted no adapter at all, in every
// state and not only while a carrier module was off. An operator who used it
// got a fresh `pending` row that read exactly like one a carrier had accepted,
// and nothing had left the platform. Issue #250 fixed the *createShipment*
// silence and the surface it added routes recovery to the generate endpoint for
// precisely this reason, so the second silent path was the last one left.
//
// The test is written over the service's **whole public surface** rather than
// over a named method, because that is the shape of the defect: nothing here
// asserted, either way, whether an attempt-opening path contacted a carrier, so
// a path that contacted nobody was indistinguishable from one that did. A new
// method that persists a Shipment and asks nobody goes red here on the day it
// is written, whatever it is called.

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodReadPort,
  DeliveryMethodRecord,
  OrderReadPort,
  OrderRecord,
  ShippingAdapter,
} from '@b2b/contracts';
import type { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import { ShipmentService } from '../../../src/modules/shipments/services/shipment-service.js';
import type { ShippingEventBus } from '../../../src/modules/shipments/services/events.js';
import type { Shipment } from '../../../src/modules/shipments/entities/shipment.entity.js';

const ORDER_ID = 'dddddddd-0000-4000-8000-000000000001';
const METHOD_ID = 'dddddddd-0000-4000-8000-000000000002';
const ADAPTER_KEY = 'carrier_express';

/** Every public method of the service, so no path can be left undriven. */
function publicMethodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof (prototype as Record<string, unknown>)[name] === 'function',
  );
}

interface Recorder {
  /** Shipment rows the driven method persisted. */
  readonly opened: Array<Record<string, unknown>>;
  /** Adapter keys the carrier was actually asked about. */
  readonly asked: string[];
}

/**
 * The state a retry path exists for: one prior attempt that failed. Both
 * `createShipment` and any retry-shaped path get past their guards here, so a
 * path that opens a row without asking has nowhere to hide behind a refusal.
 */
function priorFailedAttempt(): Shipment {
  return {
    id: randomUUID(),
    orderId: ORDER_ID,
    deliveryMethodId: METHOD_ID,
    status: 'failure',
    failureReason: 'carrier rejected',
    attemptNo: 1,
  } as unknown as Shipment;
}

function harness(recorder: Recorder): ShipmentService {
  const em = {
    async transactional<T>(cb: (tx: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
    async findOne(): Promise<Shipment> {
      return priorFailedAttempt();
    },
    async find(): Promise<Shipment[]> {
      return [];
    },
    create(_entity: unknown, data: Record<string, unknown>): Shipment {
      recorder.opened.push(data);
      return { id: randomUUID(), ...data } as unknown as Shipment;
    },
    async persistAndFlush(): Promise<void> {},
    persist(): void {},
  };

  const adapter: ShippingAdapter = {
    adapterKey: ADAPTER_KEY,
    validateUseOnStorefront: async () => true,
    validateUseOnAdmin: async () => true,
    validateUseInApi: async () => true,
    onOrderCreated: async () => {},
    onShipmentCreated: async () => {
      recorder.asked.push(ADAPTER_KEY);
      return { kind: 'pending' };
    },
    onReceiveShipment: async () => ({ result: 'success' }),
  };

  // Contributed and present: the carrier is reachable, so "the adapter was not
  // asked" can only mean the path never tried.
  const registry = new ShippingAdapterRegistry(undefined, () => true);
  registry.register(adapter, 'carrier');

  const orderRead = {
    findById: async () =>
      ({
        id: ORDER_ID,
        businessId: 'ORD-257',
        deliveryMethodId: METHOD_ID,
        salesChannelId: randomUUID(),
        placedByCustomerAccountId: randomUUID(),
      }) as unknown as OrderRecord,
  } as unknown as OrderReadPort;

  const deliveryMethodRead = {
    findById: async () =>
      ({ id: METHOD_ID, adapter: ADAPTER_KEY }) as unknown as DeliveryMethodRecord,
  } as unknown as DeliveryMethodReadPort;

  const auditLog = {
    recordWithin(_em: EntityManager, input: unknown) {
      return input;
    },
  } as unknown as AuditLogService;

  const events = {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    emit(): void {},
  } as unknown as ShippingEventBus;

  return new ShipmentService(
    () => em as unknown as EntityManager,
    registry,
    orderRead,
    deliveryMethodRead,
    auditLog,
    events,
  );
}

describe('shipments — a path that opens an attempt asks the carrier (#257)', () => {
  it('asks the carrier on every public path that persists a Shipment', async () => {
    const methods = publicMethodsOf(ShipmentService.prototype);
    // A green must not be able to mean "nothing was driven".
    expect(methods.length).toBeGreaterThan(0);

    let attemptsOpened = 0;

    for (const method of methods) {
      const recorder: Recorder = { opened: [], asked: [] };
      const service = harness(recorder);
      const call = (service as unknown as Record<string, (id: string) => Promise<unknown>>)[
        method
      ]!;

      // A path that refuses opens no row, and refusing is not the defect.
      await call.call(service, ORDER_ID).catch(() => undefined);

      attemptsOpened += recorder.opened.length;
      if (recorder.opened.length > 0) {
        expect(
          recorder.asked,
          `ShipmentService.${method} opened ${recorder.opened.length} shipment attempt(s) ` +
            `without asking the carrier — an operator sees a row and no carrier has heard of it`,
        ).toContain(ADAPTER_KEY);
      }
    }

    // ...and neither can it mean "no path opened an attempt".
    expect(attemptsOpened).toBeGreaterThan(0);
  });

  it('opens the next attempt after a failure and asks the carrier for it (FR-024)', async () => {
    // FR-024 — a failed generation is retryable, appending an attempt without
    // discarding the prior ones. Generating again is what satisfies it, and it
    // is the only path that does: it reads the order, opens attempt n+1 and
    // hands it to the carrier.
    const recorder: Recorder = { opened: [], asked: [] };
    const service = harness(recorder);

    const next = await service.createShipment(ORDER_ID);

    expect(next.attemptNo).toBe(2);
    expect(next.status).toBe('pending');
    expect(recorder.asked).toEqual([ADAPTER_KEY]);
  });
});
