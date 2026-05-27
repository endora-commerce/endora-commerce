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
  dependencies: [],
});
