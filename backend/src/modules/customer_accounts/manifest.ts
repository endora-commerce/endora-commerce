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
  // `auth` owns `authSessionPort`, which `CustomerAuthService` resolves to mint
  // and destroy a customer session; the edge became real with the conversion
  // (feature 072, T094) and stays binding — a platform that cannot mint a
  // session must refuse the login rather than issue one nothing can validate.
  // It is *only* that: feature 075's Phase C took password hashing and the TOTP
  // primitives out of this edge, because a pure function has no owner to be
  // switched off.
  // `customer_accounts.organization_id` and `customer_accounts.customer_group_id`
  // are real foreign keys, and feature 072 is what made them visible: the module
  // exports its entities now, so the ORM registry attributes the table to it and
  // the FK-drift check can see across the boundary. The edges predate the
  // conversion — they were simply unattributable while the table belonged to
  // nobody. `customer_groups` is owned by `price_lists`.
  dependencies: ['auth', 'organizations', 'price_lists'],
  // Feature 074 (Constitution XVII), test C1 — reachability. The flag used to
  // rest on four port edges another module declares; ruling 2 withdraws that
  // authority, so the ground is now this module's own and it is the stronger
  // one anyway. This module owns the identity a buyer signs in as. Switch it
  // off and no customer-side path exists at all — no registration, no login,
  // no cart belonging to anyone, no order placed by anyone — which is the
  // reachability test rather than a reduction in capability.
  activation: {
    nonDeactivatable: true,
    reason:
      'The identity a buyer signs in as; no customer-side path — registration, login, cart, ' +
      'order or account — exists without it.',
  },
});
