import { describe, expect, it, vi } from 'vitest';
import { AutoShipmentOnPaidNotifier } from '../../../../packages/modules/shipments/src/backend/services/auto-shipment-on-paid.js';
import type { ShipmentService } from '../../../../packages/modules/shipments/src/backend/services/shipment-service.js';
import type {
  DeliveryMethodReadPort,
  OrderReadPort,
  ShippingAdapter,
  ShippingAdapterRegistryPort,
} from '@endora-commerce/contracts';

/**
 * The order and the delivery method are read over their owners' ports, so the
 * fixtures are those two ports rather than a chain of `findOne` calls on one
 * EntityManager. Only the latest `Shipment` row is this module's own read.
 */
function notifierFor(options: {
  adapter: Pick<ShippingAdapter, 'adapterKey' | 'shouldAutoCreateOnPaid'>;
  latestShipment: { id: string; status: string } | null;
  createShipment: () => unknown;
}): AutoShipmentOnPaidNotifier {
  const orderRead = {
    findById: async () => ({ id: 'o1', deliveryMethodId: 'dm1' }),
  } as unknown as OrderReadPort;
  const deliveryMethodRead = {
    findById: async () => ({ id: 'dm1', adapter: options.adapter.adapterKey }),
  } as unknown as DeliveryMethodReadPort;
  return new AutoShipmentOnPaidNotifier(
    () => ({ findOne: vi.fn(async () => options.latestShipment) }) as never,
    { get: () => options.adapter } as unknown as ShippingAdapterRegistryPort,
    orderRead,
    deliveryMethodRead,
    { createShipment: options.createShipment } as unknown as ShipmentService,
  );
}

describe('AutoShipmentOnPaidNotifier', () => {
  it('creates a shipment when adapter opts in and none pending/success', async () => {
    const createShipment = vi.fn(async () => ({ id: 'ship-1' }));
    const notifier = notifierFor({
      adapter: { adapterKey: 'inpost_courier', shouldAutoCreateOnPaid: async () => true },
      latestShipment: null,
      createShipment,
    });
    await notifier.maybeCreate('o1');
    expect(createShipment).toHaveBeenCalledWith('o1');
  });

  it('skips when adapter does not opt in', async () => {
    const createShipment = vi.fn();
    const notifier = notifierFor({
      adapter: { adapterKey: 'manual_courier' },
      latestShipment: null,
      createShipment,
    });
    await notifier.maybeCreate('o1');
    expect(createShipment).not.toHaveBeenCalled();
  });

  it('skips when a pending shipment already exists', async () => {
    const createShipment = vi.fn();
    const notifier = notifierFor({
      adapter: { adapterKey: 'inpost_locker', shouldAutoCreateOnPaid: async () => true },
      latestShipment: { id: 's1', status: 'pending' },
      createShipment,
    });
    await notifier.maybeCreate('o1');
    expect(createShipment).not.toHaveBeenCalled();
  });
});
