import { defineModuleManifest } from '@b2b/contracts';

/**
 * Customer Accounts module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'customer_accounts',
  name: 'Customer Accounts',
  description:
    'Customer (B2B) account records, including organization membership and role.',
  version: '1.0.0',
  // `auth` owns `sessionService`, which `CustomerAuthService` takes; the edge
  // became real with the conversion (feature 072, T094).
  // `customer_accounts.organization_id` and `customer_accounts.customer_group_id`
  // are real foreign keys, and feature 072 is what made them visible: the module
  // exports its entities now, so the ORM registry attributes the table to it and
  // the FK-drift check can see across the boundary. The edges predate the
  // conversion — they were simply unattributable while the table belonged to
  // nobody. `customer_groups` is owned by `price_lists`.
  dependencies: ['auth', 'organizations', 'price_lists'],
  // Feature 072/073 (Constitution XVII). Every customer session, every
  // storefront login and every organization membership resolves through this
  // module's table. A deployment with it switched off has no customers, which
  // is not a smaller platform but a broken one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Holds the customer accounts every session, login and organization membership resolves ' +
      'through; switched off, the storefront has no customers.',
  },
});
