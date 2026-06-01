import { ShippingAdapterRegistry } from './shipping-adapter-registry.js';

/**
 * Process-wide ShippingAdapterRegistry (feature 035).
 *
 * The module lifecycle install-hook context is fixed (`{ em, redis, log,
 * module }`) and cannot carry services, so an external shipping-method module
 * cannot receive the registry through dependency injection. This shared
 * singleton is the explicit cross-module interface a module's `installHook`
 * imports to register its adapter on enable:
 *
 *   import { shippingAdapterRegistry } from '.../delivery_methods/services/registry-singleton.js';
 *   import { DeliveryMethodReconciler } from '.../delivery_methods/services/delivery-method-reconciler.js';
 *
 *   export const installHook: ModuleInstallHook = async (ctx) => {
 *     shippingAdapterRegistry.register(myAdapter);
 *     await new DeliveryMethodReconciler(() => ctx.em).ensureMethodForAdapter(
 *       myAdapter.adapterKey,
 *       { code: 'inpost', name: { default: 'InPost' } },
 *     );
 *   };
 *
 * `commerceModule` populates this same instance with the built-in adapters and
 * passes it to the delivery-method routes + order service, so an adapter
 * registered from an install hook is immediately recognised by the live
 * eligibility, admin-upsert, and order-placement paths.
 */
export const shippingAdapterRegistry = new ShippingAdapterRegistry();
