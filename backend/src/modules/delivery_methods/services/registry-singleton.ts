import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';
import { ShippingAdapterRegistry } from './shipping-adapter-registry.js';

/**
 * Process-wide ShippingAdapterRegistry (feature 035).
 *
 * `delivery_methods` pushes the two bundled offline adapters into this instance
 * from its boot hook; a carrier module contributes its own the same way, naming
 * itself as it does. One instance per process, so an adapter contributed by any
 * module is immediately recognised by the live eligibility, admin-upsert and
 * order-placement paths.
 *
 * The presence probe is wired here rather than in the class — see the payment
 * twin (issue #96).
 */
export const shippingAdapterRegistry = new ShippingAdapterRegistry(undefined, (moduleId) =>
  effectiveState.isPresent(moduleId),
);
