import type {
  ShippingAdapter,
  ShippingEligibilityContext,
  OrderCreatedContext,
  ShipmentCreatedContext,
  StartShipmentResult,
  ReceiveShipmentContext,
  ShipmentOutcome,
} from '@b2b/contracts';

/**
 * Built-in shipping adapters (feature 035). Two bundled offline reference
 * adapters — neither needs an external carrier, so the full
 * order_created → shipment_created → receive_shipment lifecycle is testable
 * end-to-end out of the box (FR-004, SC-003).
 *
 * Validators default to `() => true` (FR-010). `onOrderCreated` is a no-op
 * (the spec allows skipping it). `onReceiveShipment` echoes the outcome the
 * ingress already validated — the offline adapters are settled by an admin /
 * out-of-band.
 */
abstract class BaseShippingAdapter implements ShippingAdapter {
  abstract readonly adapterKey: string;

  async validateUseOnStorefront(_ctx: ShippingEligibilityContext): Promise<boolean> {
    return true;
  }
  async validateUseOnAdmin(_ctx: ShippingEligibilityContext): Promise<boolean> {
    return true;
  }
  async validateUseInApi(_ctx: ShippingEligibilityContext): Promise<boolean> {
    return true;
  }

  /** No creation-time work for the offline adapters. */
  async onOrderCreated(_ctx: OrderCreatedContext): Promise<void> {
    return;
  }

  abstract onShipmentCreated(ctx: ShipmentCreatedContext): Promise<StartShipmentResult>;

  /**
   * Default: the ingress is the source of truth for the outcome. Provider
   * details and the external reference flow straight onto the Shipment row.
   */
  async onReceiveShipment(ctx: ReceiveShipmentContext): Promise<ShipmentOutcome> {
    return {
      result: 'success',
      externalReference: ctx.externalReference ?? null,
      ...(ctx.providerDetails ? { providerDetails: ctx.providerDetails } : {}),
    };
  }
}

/**
 * Manual courier (Wysyłka własna) — an operator generates the parcel
 * out-of-band and reports the outcome via `receive_shipment`.
 */
export class ManualCourierAdapter extends BaseShippingAdapter {
  readonly adapterKey = 'manual_courier';

  async onShipmentCreated(): Promise<StartShipmentResult> {
    return { kind: 'pending' };
  }
}

/**
 * Personal pickup (Odbiór osobisty) — no carrier; generation succeeds as soon
 * as a shipment is opened (still confirmed via `receive_shipment`).
 */
export class PersonalPickupAdapter extends BaseShippingAdapter {
  readonly adapterKey = 'personal_pickup';

  async onShipmentCreated(): Promise<StartShipmentResult> {
    return { kind: 'generated' };
  }
}

/** The adapters registered for the platform's built-in shipping methods. */
export function builtInShippingAdapters(): ShippingAdapter[] {
  return [new ManualCourierAdapter(), new PersonalPickupAdapter()];
}
