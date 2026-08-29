import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShipmentUsagePort } from '@endora-commerce/contracts';
import { Shipment } from '../entities/shipment.entity.js';

/**
 * The read behind `shipmentUsagePort` — see the port's contract for why the
 * question belongs to this module and what its caller does when the module is
 * off (feature 075, the `delivery_methods` shard).
 *
 * One `count`, on this module's own `EntityManager`. Deliberately not a method
 * on {@link ShipmentService}: that service opens shipment attempts and calls
 * carriers, and a delete guard has no business resolving an adapter registry,
 * an order port and a delivery-method port to ask how many rows exist.
 */
export class ShipmentUsageService implements ShipmentUsagePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Every status counts, `failure` and `pending_manual` included: a failed
   * attempt is still history an operator can open, and it still names the
   * method it was attempted with.
   */
  async countForDeliveryMethod(deliveryMethodId: string): Promise<number> {
    return this.emFactory().count(Shipment, { deliveryMethodId });
  }
}
