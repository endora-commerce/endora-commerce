import { defineModuleManifest } from '@b2b/contracts';

/**
 * Addresses module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'addresses',
  name: 'Addresses',
  description:
    'Reusable address entities used by organizations, customers, and order fulfilment.',
  version: '1.0.0',
  // `addresses.organization_id` foreign-keys `organizations`. The edge was
  // found by the FK-drift validator (feature 065) and is genuinely declarable:
  // quick_order → addresses → organizations → settings stays acyclic.
  //
  // `dictionaries` added with the conversion (feature 072, T090): the one
  // `AddressService` resolves `dictionaryValidator` to check country and region
  // codes, so the edge is real and was previously invisible to the lifecycle.
  dependencies: ['dictionaries', 'organizations'],
  // Feature 074 (Constitution XVII), test C2 — functional base. The flag was
  // previously carried by a port edge: `organizations` resolves this module's
  // `addressService`, and that reached this manifest through the other one's
  // declaration. Ruling 2 withdraws that authority — a module a criterion
  // module happens to resolve is not thereby core — so the ground here is now
  // this module's own. Every B2B document is addressed: an order ships
  // somewhere, an invoice is billed somewhere, a shipment has a destination.
  // A platform that cannot record where is not a smaller commerce platform,
  // it is one that cannot complete a transaction.
  activation: {
    nonDeactivatable: true,
    reason:
      'Every B2B document — order, invoice, shipment — is addressed; there is no transaction ' +
      'without one.',
  },
});
