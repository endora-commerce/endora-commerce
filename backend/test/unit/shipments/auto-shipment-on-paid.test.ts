import { describe, expect, it, vi } from 'vitest';
import { AutoShipmentOnPaidNotifier } from '../../../src/modules/shipments/services/auto-shipment-on-paid.js';
import type { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import type { ShipmentService } from '../../../src/modules/shipments/services/shipment-service.js';
import type { ShippingAdapter } from '@b2b/contracts';

describe('AutoShipmentOnPaidNotifier', () => {
  it('creates a shipment when adapter opts in and none pending/success', async () => {
    const createShipment = vi.fn(async () => ({ id: 'ship-1' }));
    const adapter: Pick<ShippingAdapter, 'adapterKey' | 'shouldAutoCreateOnPaid'> = {
      adapterKey: 'inpost_courier',
      shouldAutoCreateOnPaid: async () => true,
    };
    const notifier = new AutoShipmentOnPaidNotifier(
      () =>
        ({
          findOne: vi
            .fn()
            .mockResolvedValueOnce({ id: 'o1', deliveryMethodId: 'dm1' })
            .mockResolvedValueOnce({ id: 'dm1', adapter: 'inpost_courier' })
            .mockResolvedValueOnce(null),
        }) as never,
      { get: () => adapter } as unknown as ShippingAdapterRegistry,
      { createShipment } as unknown as ShipmentService,
    );
    await notifier.maybeCreate('o1');
    expect(createShipment).toHaveBeenCalledWith('o1');
  });

  it('skips when adapter does not opt in', async () => {
    const createShipment = vi.fn();
    const adapter: Pick<ShippingAdapter, 'adapterKey'> = {
      adapterKey: 'manual_courier',
    };
    const notifier = new AutoShipmentOnPaidNotifier(
      () =>
        ({
          findOne: vi
            .fn()
            .mockResolvedValueOnce({ id: 'o1', deliveryMethodId: 'dm1' })
            .mockResolvedValueOnce({ id: 'dm1', adapter: 'manual_courier' }),
        }) as never,
      { get: () => adapter } as unknown as ShippingAdapterRegistry,
      { createShipment } as unknown as ShipmentService,
    );
    await notifier.maybeCreate('o1');
    expect(createShipment).not.toHaveBeenCalled();
  });

  it('skips when a pending shipment already exists', async () => {
    const createShipment = vi.fn();
    const adapter: Pick<ShippingAdapter, 'adapterKey' | 'shouldAutoCreateOnPaid'> = {
      adapterKey: 'inpost_locker',
      shouldAutoCreateOnPaid: async () => true,
    };
    const notifier = new AutoShipmentOnPaidNotifier(
      () =>
        ({
          findOne: vi
            .fn()
            .mockResolvedValueOnce({ id: 'o1', deliveryMethodId: 'dm1' })
            .mockResolvedValueOnce({ id: 'dm1', adapter: 'inpost_locker' })
            .mockResolvedValueOnce({ id: 's1', status: 'pending' }),
        }) as never,
      { get: () => adapter } as unknown as ShippingAdapterRegistry,
      { createShipment } as unknown as ShipmentService,
    );
    await notifier.maybeCreate('o1');
    expect(createShipment).not.toHaveBeenCalled();
  });
});
