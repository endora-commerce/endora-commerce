import { ERROR_CODES, type ShipmentUsagePort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { ShipmentUsageCounter } from '../commands/delivery-method.commands.js';

/** What the counter needs, so a test supplies both halves without a container. */
export interface ShipmentUsageCounterDeps {
  /** `effectiveState.isPresent('shipments')`, injected so this stays testable. */
  readonly isShipmentsPresent: () => boolean;
  /** `lazyPort<ShipmentUsagePort>(ctx, 'shipmentUsagePort')`, resolved per call. */
  readonly shipmentUsage: () => ShipmentUsagePort;
}

/**
 * "How many shipments were created against this delivery method?" — asked of
 * `shipments`, which owns the rows (feature 075, the `delivery_methods` shard).
 *
 * **Presence is decided before the port is resolved**, which is the
 * `auth`/`api_keys` shape and the reason this edge is declared as
 * `nonBindingDependencies` rather than as an ordinary dependency: `shipments`
 * declares this module, so declaring it back closes a manifest cycle, and
 * acknowledging it would put `delivery_methods` among the dependents that
 * refuse the flip — making the shipment module unswitchable for as long as a
 * shop offers delivery. There is deliberately no `catch` anywhere near the
 * resolution: a caught gate is a fail-open degrade nobody declared.
 *
 * **The degradation is a refusal, not a shortcut.** `shipments.delivery_method_id`
 * carries no foreign key, so this count is the only thing standing between a
 * delete and permanently orphaned shipment history — and switching the module
 * off is exactly when nothing on the operator's screen would show that the
 * history exists. Off is meant to be reversible; a delete taken blind here is
 * not. So the operator is told which switch to flip and nothing is destroyed.
 */
export function makeShipmentUsageCounter(deps: ShipmentUsageCounterDeps): ShipmentUsageCounter {
  return async (deliveryMethodId: string): Promise<number> => {
    if (!deps.isShipmentsPresent()) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Cannot delete delivery method: the "shipments" module is switched off, so the ' +
          'platform cannot tell whether any shipment was created against this method. ' +
          'Switch shipments on and try again, or set this method\'s status to "inactive".',
      );
    }
    return deps.shipmentUsage().countForDeliveryMethod(deliveryMethodId);
  };
}
