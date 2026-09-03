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
  /**
   * The module's own authority (2026-08-28).
   *
   * All four admin routes used to enforce `catalog:write` — the two reads
   * included — so whoever could edit a product could read the tax table,
   * rewrite a rate, move the default rule and delete a rule outright. A rate is
   * the figure every price, every order total and every invoice is computed
   * from, and this module is the one the platform refuses to switch off on the
   * ground that a shop which cannot compute tax cannot state a lawful price;
   * the authority over that figure was the catalogue's. `catalog:write` was
   * real, declared and enforced, so the permission inventory's two directions
   * were clean over the site, and `check:action-route-permissions` never looked
   * at all: this module declares no manifest action, so the check has nothing
   * of its own to compare.
   *
   * A pair and no third code, spelled `<module id>:<read|write>` like the five
   * gateway modules, `payment_methods`, `delivery_methods`, `returns` and
   * `invoices`. A prefix that is not its owner's id is the mistake
   * `PERMISSION_CATALOGUE` comments on twice (`integrations:manage`,
   * `audit_log:read`), both frozen because they are persisted in role rows;
   * getting it right on a code that does not exist yet is free. The codes stay
   * here rather than in `PERMISSION_CATALOGUE`, which is for codes spanning
   * modules — this module owns these outright.
   *
   * The read half is a capability that did not exist before rather than a
   * rename of one: there was no read gate to move, so `taxes:read` is what
   * finally lets an operator be shown a VAT rate without being handed the
   * authority to change it.
   *
   * No data migration: see `test/contract/taxes/permission-authority.test.ts`.
   */
  permissions: [
    { code: 'taxes:read', label: 'View tax rules' },
    { code: 'taxes:write', label: 'Configure tax rules' },
  ],
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
  // Feature 091 (Phase 4, batch 8) — this module ships a bundle now: its
  // sidebar entry's `labelKey` is module-relative (R8) and resolves in this
  // module's own namespace. Its screen's copy stays in `_i18n`'s `core`
  // scope, which is batch 4's shape and not a new one.
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  activation: {
    nonDeactivatable: true,
    reason:
      'Absent, every price becomes tax-free with no operator-visible signal and the invoice ' +
      'carries a wrong figure. A platform that cannot compute tax cannot state a lawful price.',
  },
});
