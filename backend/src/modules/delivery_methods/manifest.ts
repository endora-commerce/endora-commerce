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
 * recognised as a shipping-method adapter iff it registers a `ShippingAdapter`
 * in the process-wide `shippingAdapterRegistry` (see
 * services/registry-singleton.ts) from its **boot hook**, naming itself as the
 * contributing module. Not from `installHook`: the registry is an in-memory
 * table per process, install runs once in the CLI process, and the serving
 * process reads what its own composition pushed. The `delivery_methods` row is
 * static reference data and ships as the contributing module's migration;
 * `DeliveryMethodReconciler.ensureMethodForAdapter(...)` stays available from
 * an `installHook` for a row that must be created from code.
 *
 * No `uninstallHook` withdraws the adapter, and none should: the registry
 * records the contributing module on every entry and filters its enumeration on
 * that module's effective state, so an absent contributor is answered at the
 * read. The row and its Shipments are preserved either way (FR-003). See
 * docs/docs/modules/delivery_methods.md § *When the registry is read*.
 */
export const manifest = defineModuleManifest({
  id: 'delivery_methods',
  name: 'Delivery Methods',
  description:
    'Shipping/delivery method definitions and per-channel availability.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T095).
  // `organizations` since feature 072 (T138) — see the payment twin.
  dependencies: ['auth', 'organizations'],
  settings: {
    moduleCode: 'delivery_methods',
    groups: [{ code: 'delivery_methods', name: 'Delivery methods' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'delivery_methods.enabled',
        name: 'Delivery methods enabled',
        description:
          'Switches the delivery-method catalog on or off: the admin screens that define methods and their per-channel availability, and the public list a checkout picks from. Nothing is dropped — every method, its channel bindings and the shipments already created against it stay in the database, and the catalog returns exactly as configured when you switch it back on.',
        groupCode: 'delivery_methods',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 073, Amendment A1 (Constitution XVII) — deactivatable, because the
  // reason it used to give does not hold. "The platform cannot take an order"
  // rests on an edge that is not in the graph: `orders` declares `addresses`,
  // `api_keys`, `carts`, `credit_limits`, `organizations`, `promotions`,
  // `settings` and `transactional_emails`, and neither this module nor
  // `payment_methods`. The dependents that do declare it — `payments`,
  // `quick_order`, `shipments` — fail closed when it is off, which is the
  // intended meaning of switching a delivery catalog off, not an accident.
  activation: { settingCode: 'delivery_methods.enabled', default: true },
});
