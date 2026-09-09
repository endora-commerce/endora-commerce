// Issue #250 — a shipment created while its carrier module is switched off has
// to say so.
//
// The gate is not what changed: `shippingAdapterRegistry` is a contribution
// point and it correctly enumerates nothing for an absent owner (D-39). What
// changed is what happens next. The row used to be written `pending` with the
// adapter hook skipped, so a shipment with no label, no tracking number and no
// carrier that had heard of it was indistinguishable from a completed one.
//
// Three outcomes are asserted separately, because they are three different
// sentences and one green must not stand in for another's: the carrier was
// asked, the carrier's module is absent, and there is no carrier integration at
// all.

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodReadPort,
  DeliveryMethodRecord,
  OrderReadPort,
  OrderRecord,
  ShippingAdapter,
} from '@endora-commerce/contracts';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { ShippingAdapterRegistry } from '../../../../packages/modules/delivery_methods/src/backend/services/shipping-adapter-registry.js';
import {
  ShipmentService,
  carrierNotContactedReason,
} from '../../../../packages/modules/shipments/src/backend/services/shipment-service.js';
import type { ShippingEventBus } from '../../../../packages/modules/shipments/src/backend/services/events.js';
import type { Shipment } from '../../../../packages/modules/shipments/src/backend/entities/shipment.entity.js';

const ORDER_ID = 'cccccccc-0000-4000-8000-000000000001';
const METHOD_ID = 'cccccccc-0000-4000-8000-000000000002';

/** A carrier adapter that records whether the carrier was actually asked. */
function carrierAdapter(adapterKey: string, asked: string[]): ShippingAdapter {
  return {
    adapterKey,
    validateUseOnStorefront: async () => true,
    validateUseOnAdmin: async () => true,
    validateUseInApi: async () => true,
    onOrderCreated: async () => {},
    onShipmentCreated: async () => {
      asked.push(adapterKey);
      return { kind: 'pending' };
    },
    onReceiveShipment: async () => ({ result: 'success' }),
  };
}

/**
 * The narrowest `EntityManager` this operation needs: one transaction, one
 * lookup of the previous attempt, one create, one flush. Nothing here decides
 * anything the test asserts — the decision under test is the service's.
 */
function fakeEmFactory(): () => EntityManager {
  const em = {
    async transactional<T>(cb: (tx: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
    async findOne(): Promise<null> {
      return null;
    },
    create(_entity: unknown, data: Record<string, unknown>): Shipment {
      return { id: randomUUID(), ...data } as unknown as Shipment;
    },
    async persistAndFlush(): Promise<void> {},
    persist(): void {},
  };
  return () => em as unknown as EntityManager;
}

function orderReadPort(): OrderReadPort {
  return {
    findById: async () =>
      ({
        id: ORDER_ID,
        businessId: 'ORD-250',
        deliveryMethodId: METHOD_ID,
        salesChannelId: randomUUID(),
        placedByCustomerAccountId: randomUUID(),
      }) as unknown as OrderRecord,
    findByIds: async () => [],
    listAll: async () => [],
    listItems: async () => [],
    findIdsByBusinessIdLike: async () => [],
    salesChannelIdsForCustomer: async () => [],
  } as unknown as OrderReadPort;
}

function deliveryMethodReadPort(adapter: string): DeliveryMethodReadPort {
  return {
    findById: async () => ({ id: METHOD_ID, adapter }) as unknown as DeliveryMethodRecord,
  } as unknown as DeliveryMethodReadPort;
}

interface Harness {
  create(): Promise<Shipment>;
  readonly asked: string[];
  readonly audited: RecordAuditInput[];
  readonly emitted: Array<Record<string, unknown>>;
}

/**
 * `carrierPresent` is the presence probe the registry is built with — the same
 * seam the process singleton wires to `effectiveState.isPresent`.
 */
function harness(opts: {
  methodAdapter: string;
  registered?: { adapterKey: string; owner: string };
  carrierPresent: boolean;
}): Harness {
  const asked: string[] = [];
  const audited: RecordAuditInput[] = [];
  const emitted: Array<Record<string, unknown>> = [];

  const registry = new ShippingAdapterRegistry(undefined, () => opts.carrierPresent);
  if (opts.registered) {
    registry.register(carrierAdapter(opts.registered.adapterKey, asked), opts.registered.owner);
  }

  const auditLog = {
    recordWithin(_em: EntityManager, input: RecordAuditInput) {
      audited.push(input);
      return input;
    },
  } as unknown as AuditPort;

  const events = {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    emit(_name: string, payload: Record<string, unknown>): void {
      emitted.push(payload);
    },
  } as unknown as ShippingEventBus;

  const service = new ShipmentService(
    fakeEmFactory(),
    registry,
    orderReadPort(),
    deliveryMethodReadPort(opts.methodAdapter),
    auditLog,
    events,
  );

  return { create: () => service.createShipment(ORDER_ID), asked, audited, emitted };
}

describe('shipments — a shipment whose carrier module is absent (#250)', () => {
  it('opens pending and asks the carrier while the carrier module is present', async () => {
    const h = harness({
      methodAdapter: 'carrier_express',
      registered: { adapterKey: 'carrier_express', owner: 'carrier' },
      carrierPresent: true,
    });

    const shipment = await h.create();

    expect(shipment.status).toBe('pending');
    expect(shipment.failureReason ?? null).toBeNull();
    expect(h.asked).toEqual(['carrier_express']);
    expect(h.audited).toHaveLength(0);
    expect(h.emitted[0]).toMatchObject({ status: 'pending' });
  });

  it('opens pending_manual, names the module and asks nobody while it is off', async () => {
    const h = harness({
      methodAdapter: 'carrier_express',
      registered: { adapterKey: 'carrier_express', owner: 'carrier' },
      carrierPresent: false,
    });

    const shipment = await h.create();

    expect(shipment.status).toBe('pending_manual');
    expect(shipment.failureReason).toBe(carrierNotContactedReason('carrier'));
    expect(shipment.failureReason).toContain('carrier');
    // The whole point: no request left the platform.
    expect(h.asked).toEqual([]);
  });

  it('records the attempt as an audit row on the shipment it describes', async () => {
    const h = harness({
      methodAdapter: 'carrier_express',
      registered: { adapterKey: 'carrier_express', owner: 'carrier' },
      carrierPresent: false,
    });

    const shipment = await h.create();

    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      action: 'shipment.carrier_not_contacted',
      objectType: 'shipment',
      objectId: shipment.id,
    });
    expect(h.audited[0]!.stateAfter).toMatchObject({
      absentModule: 'carrier',
      adapter: 'carrier_express',
      status: 'pending_manual',
    });
  });

  it('carries the state on shipment.created.v1 so the notifier can refuse the e-mail', async () => {
    const h = harness({
      methodAdapter: 'carrier_express',
      registered: { adapterKey: 'carrier_express', owner: 'carrier' },
      carrierPresent: false,
    });

    await h.create();

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({ adapter: 'carrier_express', status: 'pending_manual' });
  });

  it('leaves an offline method with no adapter at all on plain pending', async () => {
    // Nobody ever contributed this key, so there is no module to switch on and
    // nothing has changed for a method that has always been finished by hand.
    // `registry.get()` answers `undefined` here exactly as it does above, which
    // is why the two are told apart by `absentOwnerFor` rather than by it.
    const h = harness({ methodAdapter: 'manual_courier', carrierPresent: true });

    const shipment = await h.create();

    expect(shipment.status).toBe('pending');
    expect(shipment.failureReason ?? null).toBeNull();
    expect(h.audited).toHaveLength(0);
  });
});
