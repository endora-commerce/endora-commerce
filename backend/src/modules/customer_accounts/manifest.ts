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
  // `customer_accounts.organization_id` is a real foreign key, and feature 072
  // is what made it visible: the module exports its entities now, so the ORM
  // registry attributes the table to it and the FK-drift check can see across
  // the boundary. The edge predates the conversion — it was simply
  // unattributable while the table belonged to nobody.
  // `customer_accounts.customer_group_id` is a real foreign key too, and since
  // feature 076 (D-79) it points at `customer_groups`, which this module now
  // owns: the constraint is intra-module and declares nothing.
  dependencies: ['auth', 'organizations'],
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
  i18n: { bundlesDir: 'i18n' },
  // Feature 076 (D-79) — the customer-group admin surface came here with the
  // entity, and its gate came with a correction. `price_lists` served these
  // three routes under `catalog:write`, which asks a pricing question about a
  // customer's segmentation; these two codes ask the right one. Granting them
  // is a deliberate act on each admin role — nothing inherits from
  // `catalog:write`.
  permissions: [
    { code: 'customer_groups:read', label: 'View customer groups' },
    { code: 'customer_groups:write', label: 'Manage customer groups' },
  ],
  actions: [
    {
      id: 'open-customer-groups',
      labelKey: 'actions.openCustomerGroups.label',
      descriptionKey: 'actions.openCustomerGroups.description',
      icon: 'Users',
      targetRoute: '/customer-groups',
      requiredPermission: 'customer_groups:read',
      keywords: ['customer', 'group', 'segment', 'klient', 'grupa', 'segment'],
      weight: 140,
    },
  ],
});
