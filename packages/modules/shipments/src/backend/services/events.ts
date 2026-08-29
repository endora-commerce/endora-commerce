import type { ShipmentStatus } from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';

/**
 * Shipping domain events (feature 035). Emitted on the in-process EventBus
 * inside the handler's transactional scope, so a rolled-back transaction never
 * dispatches. The delivery-side twin of the payment.* events.
 */
export interface ShippingEvents extends Record<string, EventBase> {
  'shipment.created.v1': EventBase & {
    orderId: string;
    shipmentId: string;
    deliveryMethodId: string;
    adapter: string;
    attemptNo: number;
    /**
     * The state the row was opened in (issue #250). A subscriber that acts as
     * if the carrier had been asked — the customer's "your order has shipped"
     * e-mail is the one in this module — has to be able to tell a
     * `pending_manual` shipment from a `pending` one, and the event is where
     * it can, without re-reading the row it was just told about.
     */
    status: ShipmentStatus;
  };
  'shipment.received.v1': EventBase & {
    orderId: string;
    shipmentId: string;
    adapter: string;
    externalReference: string | null;
    attemptNo: number;
  };
  'shipment.failed.v1': EventBase & {
    orderId: string;
    shipmentId: string;
    adapter: string;
    failureReason: string | null;
    attemptNo: number;
  };
}

export type ShippingEventBus = EventBus<ShippingEvents>;
