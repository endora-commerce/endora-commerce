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
  // Feature 072/073 (Constitution XVII). Every checkout picks a payment method
  // from this module's table, and `orders` resolves its adapter registry to
  // dispatch on placement. A deployment with it switched off cannot take an
  // order, so the orchestrator refuses to disable it.
  activation: {
    nonDeactivatable: true,
    reason:
      'Holds the payment methods every checkout selects from and the adapter registry orders ' +
      'dispatches through; switched off, the platform cannot take an order.',
  },
});
