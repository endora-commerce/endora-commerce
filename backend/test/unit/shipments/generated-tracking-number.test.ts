// When an adapter returns `{ kind: 'generated', trackingNumber }`, the
// platform must persist that number on `shipments.external_reference`. The
// DHL adapter (and any synchronous carrier) already returns it; discarding
// the StartShipmentResult left Tracking as "—" in admin despite a live label.

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
import type { AuditPort } from '../../../src/kernel/ports/audit.js';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import { ShipmentService } from '../../../src/modules/shipments/services/shipment-service.js';
import type { ShippingEventBus } from '../../../src/modules/shipments/services/events.js';
import type { Shipment } from '../../../src/modules/shipments/entities/shipment.entity.js';

const ORDER_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const METHOD_ID = 'eeeeeeee-0000-4000-8000-000000000002';
const ADAPTER_KEY = 'carrier_with_label';
const TRACKING = 'DHL-111222333';

describe('ShipmentService.createShipment — generated tracking number', () => {
  it('writes trackingNumber onto shipments.externalReference', async () => {
    const flushed: Shipment[] = [];
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
      async persistAndFlush(entity: Shipment): Promise<void> {
        flushed.push({ ...entity } as Shipment);
      },
      persist(): void {},
    };

    const adapter: ShippingAdapter = {
      adapterKey: ADAPTER_KEY,
      validateUseOnStorefront: async () => true,
      validateUseOnAdmin: async () => true,
      validateUseInApi: async () => true,
      onOrderCreated: async () => {},
      onShipmentCreated: async () => ({ kind: 'generated', trackingNumber: TRACKING }),
      onReceiveShipment: async () => ({ result: 'success' }),
    };

    const registry = new ShippingAdapterRegistry(undefined, () => true);
    registry.register(adapter, 'carrier');

    const service = new ShipmentService(
      () => em as unknown as EntityManager,
      registry,
      {
        findById: async () =>
          ({
            id: ORDER_ID,
            businessId: 'ORD-TRACK',
            deliveryMethodId: METHOD_ID,
            salesChannelId: randomUUID(),
            placedByCustomerAccountId: randomUUID(),
          }) as unknown as OrderRecord,
      } as unknown as OrderReadPort,
      {
        findById: async () =>
          ({ id: METHOD_ID, adapter: ADAPTER_KEY }) as unknown as DeliveryMethodRecord,
      } as unknown as DeliveryMethodReadPort,
      { record: async () => {} } as unknown as AuditPort,
      { run: async (fn) => fn(), emit: () => {} } as unknown as ShippingEventBus,
    );

    const shipment = await service.createShipment(ORDER_ID);

    expect(shipment.externalReference).toBe(TRACKING);
    expect(flushed.some((row) => row.externalReference === TRACKING)).toBe(true);
  });
});
