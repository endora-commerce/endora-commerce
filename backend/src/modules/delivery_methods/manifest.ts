import { defineModuleManifest } from '@b2b/contracts';

/**
 * Delivery Methods module — manifest backfill (Module Lifecycle, feature 018);
 * the shipping-method adapter framework host (feature 035).
 *
 * Predates the lifecycle system; the core module's schema is owned by
 * platform-wide migrations (delivery_methods table + feature-035 columns in
 * migration 052). The core module itself has no install/uninstall hook.
 *
 * Recognition condition (feature 035, FR-001): a *separate* platform module is
 * recognised as a shipping-method adapter iff its `installHook` registers a
 * `ShippingAdapter` in the process-wide `shippingAdapterRegistry` (see
 * services/registry-singleton.ts) and reconciles a `delivery_methods` row via
 * `DeliveryMethodReconciler.ensureMethodForAdapter(...)`. Its `uninstallHook`
 * SHOULD `shippingAdapterRegistry.unregister(adapterKey)`; the row + its
 * Shipments are preserved (FR-003). See docs/docs/modules/shipping-methods.md.
 */
export const manifest = defineModuleManifest({
  id: 'delivery_methods',
  name: 'Delivery Methods',
  description:
    'Shipping/delivery method definitions and per-channel availability.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T095).
  dependencies: ['auth'],
  // Feature 072/073 (Constitution XVII) — the payment twin's reasoning applies
  // unchanged: a checkout with no delivery method to choose is not a smaller
  // platform, it is one that cannot complete an order.
  activation: {
    nonDeactivatable: true,
    reason:
      'Holds the delivery methods every checkout selects from and the shipping adapter registry ' +
      'orders dispatches through; switched off, the platform cannot take an order.',
  },
});
