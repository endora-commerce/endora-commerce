import { defineModuleManifest } from '@b2b/contracts';

/**
 * Credit Limits module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'credit_limits',
  name: 'Credit Limits',
  description:
    'Per-organization credit limits and credit-check enforcement at checkout.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port, the customer guard and the customer
  // context resolver this module now resolves from the container.
  //
  // D-94.1 adds `orders`, for the foreign key
  // `credit_limit_reservations_order_fk` (`credit_limit_reservations.order_id`
  // -> `orders.id`, `on delete restrict`). AGENTS.md § Migrations item 4: a
  // cross-module foreign key is declared here or the build fails, and an
  // `acknowledgedDependencies` entry does not satisfy it. The edge is mutual —
  // `placeOrder` calls `reserve({ tx })` on this module's service and this
  // module records a row against the order — so the cycle it closes is broken
  // on the *other* side: `orders` re-expresses `creditLimitService` as an
  // acknowledged edge, which drops the install ordering the constraint says is
  // backwards and keeps the bind (D-94.3).
  dependencies: ['organizations', 'auth', 'orders'],
  settings: {
    moduleCode: 'credit_limits',
    groups: [{ code: 'credit_limits', name: 'Credit limits' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'credit_limits.enabled',
        name: 'Credit limits enabled',
        description:
          'Switches deferred-payment credit limits on or off: the admin screens, the customer-facing balance and the reservation orders take against it. Nothing is dropped — configured limits and their history stay in the database and apply again when you switch it back on.',
        groupCode: 'credit_limits',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  activation: { settingCode: 'credit_limits.enabled', default: true },
});
