import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin Users module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'admin_users',
  name: 'Admin Users',
  description:
    'Admin user accounts, sessions, and impersonation flows.',
  version: '1.0.0',
  dependencies: ['admin_roles', 'auth'],
  /**
   * Feature 075, Phase C — impersonation resolves its target through
   * `customerAccountReadPort` instead of querying `customer_accounts`' entity.
   *
   * It is acknowledged rather than declared, because the ordinary declaration
   * closes a cycle `migration-order.ts` and the composer generator both refuse:
   * `customer_accounts` → `price_lists` → `catalog` → `admin_users`. The same
   * shape `auth` records against `customer_accounts` and `admin_roles` against
   * this module.
   *
   * It costs nothing on the refusal axis: `customer_accounts` is itself
   * `nonDeactivatable`, so there is no flip for the acknowledged edge to have
   * refused. The seam still fails closed — the port is gated, and an
   * impersonation that cannot identify its target must refuse rather than mint
   * a session against a customer nobody looked up.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'customer_accounts',
      port: 'customerAccountReadPort',
      reason:
        'Starting an impersonation reads the target customer account — its organisation ' +
        'membership and whether it is still live — and that row belongs to customer_accounts, ' +
        'which reaches this module transitively through price_lists and catalog. Declaring it ' +
        'here closes a cycle. The owner is non-deactivatable, so the acknowledged edge adds no ' +
        'refusal that was not there.',
    },
  ],
  // Feature 072/073 (Constitution XVII) — this module owns the admin login
  // route, the admin session and the impersonation flow. Switched off, nobody
  // can sign in to the Admin UI, including to switch it back on: the one
  // control that would undo the change is behind the door it just locked.
  activation: {
    nonDeactivatable: true,
    reason:
      'Owns admin login, sessions and impersonation; switched off, no operator could sign in ' +
      'to the Admin UI at all — including to switch it back on.',
  },
});
