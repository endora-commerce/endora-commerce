import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShipmentReadPort, ShipmentRecord } from '@endora-commerce/contracts';
import { Shipment } from '../entities/shipment.entity.js';

/**
 * The reads behind `shipmentReadPort` — see the port's contract for why a
 * carrier module asks them and what happens when this module is off.
 *
 * Deliberately not methods on {@link ShipmentService}: that service opens
 * attempts and calls carriers, and a lookup by id has no business resolving an
 * adapter registry, an order port and a delivery-method port to answer.
 */
export class ShipmentReadService implements ShipmentReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<ShipmentRecord | null> {
    const row = await this.emFactory().findOne(Shipment, { id });
    return row ? toShipmentRecord(row) : null;
  }

  async findByExternalReference(reference: string): Promise<ShipmentRecord | null> {
    const row = await this.emFactory().findOne(
      Shipment,
      { externalReference: reference },
      { orderBy: { createdAt: 'desc', attemptNo: 'desc' } },
    );
    return row ? toShipmentRecord(row) : null;
  }
}

export function toShipmentRecord(shipment: Shipment): ShipmentRecord {
  return {
    id: shipment.id,
    orderId: shipment.orderId,
    deliveryMethodId: shipment.deliveryMethodId,
    status: shipment.status,
    externalReference: shipment.externalReference ?? null,
    providerDetails: shipment.providerDetails ?? null,
    failureReason: shipment.failureReason ?? null,
    attemptNo: shipment.attemptNo,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}
