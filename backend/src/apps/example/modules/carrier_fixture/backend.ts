import type {
  OrderCreatedContext,
  ReceiveShipmentContext,
  ShipmentCreatedContext,
  ShipmentOutcome,
  ShippingAdapter,
  ShippingAdapterRegistryPort,
  ShippingEligibilityContext,
  StartShipmentResult,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../../../kernel/index.js';
import { lazyPort } from '../../../../kernel/index.js';

/**
 * `carrier_fixture` — the example deployment's stand-in carrier (feature 134,
 * FR-021/FR-063).
 *
 * ## What it implements, and why it is the whole contract
 *
 * `Required<ShippingAdapter>`, not `ShippingAdapter`. The difference is the
 * point of the module: `ShippingAdapter` makes `shouldAutoCreateOnPaid` and
 * `renderers` optional, `delivery_methods`' two offline built-ins declare
 * neither, and the only implementors of either are the two carrier modules wave
 * 1 removes. An adapter that satisfied the *required* half would leave those
 * two members published with no implementor here — which is the exact state
 * FR-021 exists to prevent, arriving through the fixture written to prevent it.
 * So both are implemented, and `Required<…>` is what refuses a fixture that
 * quietly drops one later.
 *
 * ## What it does not implement
 *
 * No settings read, no HTTP client, no persistence, no route, no permission and
 * no admin or storefront surface. Every answer below is derived from the
 * context it is handed, so the module composes in any deployment with nothing
 * configured — a fixture that needed setting up would not be one.
 *
 * ## The boot hook contributes and does not probe
 *
 * D-67/D-68: a hook that pushes an inert descriptor into another module's
 * registry must **not** ask whether its own module is present. `delivery_methods`
 * filters by contributor at every read, per request, so an operator switching
 * this module on or off takes effect immediately; a probe here would make the
 * flip need a restart. There is no work beside the contribution, so there is
 * nothing to split out.
 */

export const CARRIER_FIXTURE_MODULE_ID = 'carrier_fixture';

export const CARRIER_FIXTURE_ADAPTER_KEYS = {
  COURIER: 'carrier_fixture_courier',
  PICKUP: 'carrier_fixture_pickup',
} as const;

/**
 * Eligibility, for both adapters: the method the platform is asking about has
 * to be active. It is deliberately derived from the context rather than
 * hard-coded to `true` — a validator that cannot say no exercises none of the
 * three call sites that read it.
 */
function methodIsUsable(ctx: ShippingEligibilityContext): boolean {
  return ctx.deliveryMethod.status === 'active';
}

/**
 * The shared half of both adapters. Split out rather than repeated so that a
 * member added to the contract is implemented once and `tsc` still names this
 * file when it is not implemented at all.
 */
abstract class BaseCarrierFixtureAdapter implements Required<ShippingAdapter> {
  abstract readonly adapterKey: string;
  abstract readonly renderers: { storefront?: string; admin?: string; email?: string };

  async validateUseOnStorefront(ctx: ShippingEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  async validateUseOnAdmin(ctx: ShippingEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  async validateUseInApi(ctx: ShippingEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  /** No creation-time work: the contract says this MUST NOT open a Shipment. */
  async onOrderCreated(_ctx: OrderCreatedContext): Promise<void> {
    return;
  }

  abstract onShipmentCreated(ctx: ShipmentCreatedContext): Promise<StartShipmentResult>;

  abstract shouldAutoCreateOnPaid(): Promise<boolean>;

  /**
   * Maps the ingress to an outcome, **both ways**.
   *
   * A fixture that could only answer `success` would leave a delivery method's
   * `statusOnFailure` mapping with no adapter able to reach it, which is half of
   * what `receive_shipment` is for. `providerDetails.outcome === 'failure'` is
   * this fixture's own ingress vocabulary — a real carrier reads its webhook
   * body here — and `providerDetails.reason` carries the reason through.
   */
  async onReceiveShipment(ctx: ReceiveShipmentContext): Promise<ShipmentOutcome> {
    const details = ctx.providerDetails;
    if (details?.['outcome'] === 'failure') {
      const reason = details['reason'];
      return {
        result: 'failure',
        failureReason: typeof reason === 'string' ? reason : 'carrier_fixture_failure',
        providerDetails: details,
      };
    }
    return {
      result: 'success',
      externalReference: ctx.externalReference ?? null,
      ...(details ? { providerDetails: details } : {}),
    };
  }
}

/**
 * The asynchronous half of the contract — the shape a webhook-settled carrier
 * uses: the shipment opens `pending` with the reference the carrier will quote
 * back, and `receive_shipment` settles it later.
 */
export class CarrierFixtureCourierAdapter extends BaseCarrierFixtureAdapter {
  readonly adapterKey = CARRIER_FIXTURE_ADAPTER_KEYS.COURIER;
  readonly renderers = { storefront: 'carrier_fixture.courier' };

  async onShipmentCreated(ctx: ShipmentCreatedContext): Promise<StartShipmentResult> {
    return {
      kind: 'pending',
      externalReference: `CF-${ctx.shipmentId}-${ctx.attemptNo}`,
      providerDetails: { adapterKey: this.adapterKey, orderId: ctx.orderId },
    };
  }

  /** The opt-in half of `payment.received.v1` auto-creation (feature 068). */
  async shouldAutoCreateOnPaid(): Promise<boolean> {
    return true;
  }
}

/**
 * The synchronous half — settled inside the create transaction, with a tracking
 * number, and declining auto-creation on paid. Between the two adapters every
 * branch `shipments` takes on a contributed adapter is reachable.
 */
export class CarrierFixturePickupAdapter extends BaseCarrierFixtureAdapter {
  readonly adapterKey = CARRIER_FIXTURE_ADAPTER_KEYS.PICKUP;
  readonly renderers = { storefront: 'carrier_fixture.pickup' };

  async onShipmentCreated(ctx: ShipmentCreatedContext): Promise<StartShipmentResult> {
    return {
      kind: 'generated',
      trackingNumber: `CF-PICKUP-${ctx.shipmentId}`,
      externalReference: `CF-${ctx.shipmentId}`,
      providerDetails: { adapterKey: this.adapterKey, orderId: ctx.orderId },
    };
  }

  async shouldAutoCreateOnPaid(): Promise<boolean> {
    return false;
  }
}

/** The adapters this module contributes, in registration order. */
export function carrierFixtureAdapters(): ShippingAdapter[] {
  return [new CarrierFixtureCourierAdapter(), new CarrierFixturePickupAdapter()];
}

export function registerModule(ctx: ModuleContext): void {
  // Contribution only — the registry is read at use time and never captured
  // into a singleton, and the push names its contributor so that
  // `delivery_methods` can filter it by this module's effective state.
  ctx.onBoot(() => {
    const registry = lazyPort<ShippingAdapterRegistryPort>(ctx, 'shippingAdapterRegistry');
    for (const adapter of carrierFixtureAdapters()) {
      registry.register(adapter, CARRIER_FIXTURE_MODULE_ID);
    }
  });
}
