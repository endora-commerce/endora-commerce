import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  DeliveryMethodReadPort,
  OrderReadPort,
  ShippingAdapterRegistryPort,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { Shipment } from '../entities/shipment.entity.js';
import type { ShipmentService } from './shipment-service.js';

/**
 * Creates a shipment when payment settles and the order's shipping adapter
 * opts in via `shouldAutoCreateOnPaid()` (feature 068).
 *
 * Wired from `shipments/backend.ts` through `ctx.subscribe('payment.received.v1')`
 * — never via a bare `eventBus.on` (issue #107). Best-effort: ordinary failures
 * are swallowed so payment settlement is never blocked; `ModuleDisabledError`
 * is re-thrown so fail-closed stays fail-closed.
 *
 * The order and the delivery method are read over their owners' ports, exactly
 * as `ShipmentService` reads them (feature 075 Phase C): both rows are ones this
 * operation does not modify, so nothing is lost by leaving them on the owner's
 * EntityManager, and both fail closed when their owner is off.
 */
export class AutoShipmentOnPaidNotifier {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly registry: ShippingAdapterRegistryPort,
    private readonly orderRead: OrderReadPort,
    private readonly deliveryMethodRead: DeliveryMethodReadPort,
    private readonly shipmentService: ShipmentService,
  ) {}

  /** Exposed for unit tests. */
  async maybeCreate(orderId: string): Promise<void> {
    try {
      const order = await this.orderRead.findById(orderId);
      if (!order) return;

      const method = await this.deliveryMethodRead.findById(order.deliveryMethodId);
      const adapterKey = method?.adapter ?? order.deliveryMethodId;
      const adapter = this.registry.get(adapterKey);
      if (!adapter?.shouldAutoCreateOnPaid) return;
      if (!(await adapter.shouldAutoCreateOnPaid())) return;

      const em = this.emFactory();
      const latest = await em.findOne(
        Shipment,
        { orderId },
        { orderBy: { attemptNo: 'desc' } },
      );
      if (latest && (latest.status === 'pending' || latest.status === 'success')) return;

      await this.shipmentService.createShipment(orderId);
    } catch (error) {
      // Narrow tolerance, on purpose: `payment.received.v1` must settle the
      // payment whatever the carrier says, so an ordinary adapter failure is
      // left to the operator's "Generate shipment" button. A switched-off
      // module is not an ordinary failure and is re-thrown first.
      rethrowIfModuleDisabled(error);
    }
  }
}
