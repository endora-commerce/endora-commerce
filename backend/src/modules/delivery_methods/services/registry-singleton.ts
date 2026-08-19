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
 * Those paths read this table **per request**, never during composition — so a
 * contributor's boot hook pushes and returns, with nothing to wait for, nothing
 * to verify and no absence to react to. See the class doc block for the full
 * push/pull shape and for why a throw there costs the next start.
 *
 * The presence probe is wired here rather than in the class — see the payment
 * twin (issue #96).
 */
export const shippingAdapterRegistry = new ShippingAdapterRegistry(undefined, (moduleId) =>
  effectiveState.isPresent(moduleId),
);
