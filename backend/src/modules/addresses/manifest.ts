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
  // Feature 072/073 (Constitution XVII). Four modules store addresses through
  // this one — organizations, customers, orders, quick_order — and a delivery
  // address is not an optional part of checkout. A deployment with it switched
  // off is not a smaller platform, it is one that cannot take an order, so the
  // orchestrator refuses to disable it.
  activation: {
    nonDeactivatable: true,
    reason:
      'Stores the addresses organizations, customers, orders and quick order all read and ' +
      'write; switched off, the platform cannot complete a checkout.',
  },
});
