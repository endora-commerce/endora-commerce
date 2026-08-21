import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShippingAdapterRegistryPort } from '@b2b/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { Order } from '../../orders/entities/order.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
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
 */
export class AutoShipmentOnPaidNotifier {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly registry: ShippingAdapterRegistryPort,
    private readonly shipmentService: ShipmentService,
  ) {}

  /** Exposed for unit tests. */
  async maybeCreate(orderId: string): Promise<void> {
    try {
      const em = this.emFactory();
      const order = await em.findOne(Order, { id: orderId });
      if (!order) return;

      const method = await em.findOne(DeliveryMethod, { id: order.deliveryMethodId });
      const adapterKey = method?.adapter ?? order.deliveryMethodId;
      const adapter = this.registry.get(adapterKey);
      if (!adapter?.shouldAutoCreateOnPaid) return;
      if (!(await adapter.shouldAutoCreateOnPaid())) return;

      const latest = await em.findOne(
        Shipment,
        { orderId },
        { orderBy: { attemptNo: 'desc' } },
      );
      if (latest && (latest.status === 'pending' || latest.status === 'success')) return;

      await this.shipmentService.createShipment(orderId);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      // best-effort — never fail payment settlement
    }
  }
}
