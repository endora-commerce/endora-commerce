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
  // Feature 073, Amendment A1 (Constitution XVII). This module is not one of
  // the four the specification names as the criterion set; it holds the flag
  // because it is inside that set's *effective* closure, and the mechanism is
  // not the one the previous reason described.
  //
  // `organizations` — itself non-deactivatable — resolves this module's
  // `addressService`, because its customer routes expose address CRUD. That edge
  // is deliberately absent from the `organizations` manifest: declaring it back
  // would close the cycle this module's own `organizations` dependency opens, so
  // it is recorded in `ACKNOWLEDGED_PORT_EDGES`
  // (`backend/scripts/check-port-dependencies.ts`) instead. A closure computed
  // from manifest `dependencies` alone therefore cannot see it, which is exactly
  // why the reason has to name the port rather than a fan-out of consumers.
  activation: {
    nonDeactivatable: true,
    reason:
      'The non-deactivatable `organizations` resolves this module\'s `addressService`; the edge ' +
      'is acknowledged rather than declared, because declaring it would close a cycle.',
  },
});
