import { defineModuleManifest } from '@b2b/contracts';

/**
 * Payment Methods module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'payment_methods',
  name: 'Payment Methods',
  description:
    'Payment method definitions and per-channel availability.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T097).
  // `organizations` since feature 072 (T138): the public method list is
  // filtered by the caller's per-Organization allow-list, which this module
  // reads through `organizationRestrictionPort`. The edge existed before as a
  // root-supplied closure and was therefore invisible to the manifest.
  dependencies: ['auth', 'organizations'],
  settings: {
    moduleCode: 'payment_methods',
    groups: [{ code: 'payment_methods', name: 'Payment methods' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'payment_methods.enabled',
        name: 'Payment methods enabled',
        description:
          'Switches the payment-method catalog on or off: the admin screens that define methods and their per-channel availability, and the public list a checkout picks from. Nothing is dropped — every method, its channel bindings, its per-organization allow-list and the payments already taken against it stay in the database, and the catalog returns exactly as configured when you switch it back on.',
        groupCode: 'payment_methods',
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
  // `delivery_methods`. The dependents that do declare it — `payments`,
  // `quick_order`, and the four provider modules — fail closed when it is off,
  // which is the intended meaning of switching a payment catalog off.
  activation: { settingCode: 'payment_methods.enabled', default: true },
});
