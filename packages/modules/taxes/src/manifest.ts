import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Taxes module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'taxes',
  name: 'Taxes',
  description:
    'Tax rate configuration and order tax computation.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by;
  // `dictionaries` owns the validator that checks country and region codes.
  // Feature 072 made both container resolutions rather than optional arguments.
  dependencies: ['auth', 'dictionaries'],
  settings: {
    moduleCode: 'taxes',
    groups: [{ code: 'taxes', name: 'Taxes' }],
    // The group is kept as a reservation while the module ships no settings of
    // its own: `taxes.enabled` was the only one, and it went with the control
    // it backed (feature 074). Dropping the group too would only turn it into
    // an orphan the boot reconciler warns about at every start.
    settings: [],
  },
  // Feature 074 (Constitution XVII), test C2 — functional base, and one of the
  // escalation answers. 073 read this module as "a platform without
  // configurable tax rates is a smaller platform, not a broken one", and the
  // deciding fact is what that reading missed: the absence does not announce
  // itself. Every price becomes tax-free with no operator-visible signal and
  // the invoice carries a wrong figure. A platform that cannot compute tax
  // cannot state a lawful price, which is a different product rather than a
  // reduced one.
  //
  // This closes the *operator* route to that state. The platform route — a
  // deployment that never installs this module — is still open and is a
  // separate follow-up, which inherits one constraint: a correctly-configured
  // 0% rate is a legitimate answer in some jurisdictions, so absence and a
  // configured zero must stay distinguishable.
  //
  // `taxes.enabled` goes with the control. The existing rows are removed by a
  // core data migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'Absent, every price becomes tax-free with no operator-visible signal and the invoice ' +
      'carries a wrong figure. A platform that cannot compute tax cannot state a lawful price.',
  },
});
