import type { EventBase, EventBus } from '../../../events/bus.js';

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
