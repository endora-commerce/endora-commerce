import { PaymentAdapterRegistry } from './payment-adapter-registry.js';

/**
 * Process-wide PaymentAdapterRegistry (feature 034).
 *
 * The module lifecycle install-hook context is fixed (`{ em, redis, log,
 * module }`) and cannot carry services, so an external payment-method module
 * cannot receive the registry through dependency injection. This shared
 * singleton is the explicit cross-module interface a module's `installHook`
 * imports to register its adapter on enable:
 *
 *   import { paymentAdapterRegistry } from '.../payment_methods/services/registry-singleton.js';
 *   import { PaymentMethodReconciler } from '.../payment_methods/services/payment-method-reconciler.js';
 *
 *   export const installHook: ModuleInstallHook = async (ctx) => {
 *     paymentAdapterRegistry.register(myAdapter);
 *     await new PaymentMethodReconciler(() => ctx.em).ensureMethodForAdapter(
 *       myAdapter.adapterKey,
 *       { code: 'p24', type: 'gateway', name: { default: 'Przelewy24' } },
 *     );
 *   };
 *
 * `commerceModule` populates this same instance with the built-in adapters and
 * passes it to the payment-method routes + order service, so an adapter
 * registered from an install hook is immediately recognised by the live
 * eligibility, admin-upsert, and order-placement paths.
 */
export const paymentAdapterRegistry = new PaymentAdapterRegistry();
