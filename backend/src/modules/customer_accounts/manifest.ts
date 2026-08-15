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
  // Feature 073, Amendment A1 (Constitution XVII). Not one of the four the
  // specification names as the criterion set: this module holds the flag because
  // it is inside that set's *effective* closure, through the same mechanism as
  // `addresses`.
  //
  // `organizations` — itself non-deactivatable — serves its public
  // registration, login, password-reset and TOTP routes from four ports this
  // module owns (`customerAuthService`, `passwordResetService`,
  // `customerRoleService`, `totpEnrolmentService`). All four are deliberately
  // absent from the `organizations` manifest, because this module declares
  // `organizations` and declaring the mirror would close the cycle; they live in
  // `ACKNOWLEDGED_PORT_EDGES` (`backend/scripts/check-port-dependencies.ts`).
  activation: {
    nonDeactivatable: true,
    reason:
      'The non-deactivatable `organizations` resolves four ports this module owns (customer ' +
      'auth, password reset, roles, TOTP); the edges are acknowledged, not declared.',
  },
});
