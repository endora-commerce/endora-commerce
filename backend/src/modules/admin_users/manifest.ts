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
   * The seam fails closed — the port is gated, and an impersonation that cannot
   * identify its target must refuse rather than mint a session against a
   * customer nobody looked up. That is what the edge costs, stated as a
   * behaviour rather than as a claim about which flips are refused: the locked
   * set is re-derived on every run, and a sentence here is a copy nothing
   * refreshes (D-100).
   */
  acknowledgedDependencies: [
    {
      moduleId: 'customer_accounts',
      port: 'customerAccountReadPort',
      reason:
        'Starting an impersonation reads the target customer account — its organisation ' +
        'membership and whether it is still live — and that row belongs to customer_accounts, ' +
        'which reaches this module transitively through price_lists and catalog. Declaring it ' +
        'here closes a cycle. With customer_accounts absent the seam fails closed: an ' +
        'impersonation that cannot identify its target refuses rather than minting a session ' +
        'against a customer nobody looked up.',
    },
  ],
  /**
   * D-96 — `mfaLoginPort`, the second factor on admin login.
   *
   * Real to the container, binding on no operator. `mfa` declares this module
   * in its own `dependencies`, so the ordinary declaration closes a cycle; and
   * an acknowledged edge would put admin login among the dependents that refuse
   * the flip, which is the wrong way round — two-factor authentication is a
   * client security policy, not a platform floor, and feature 074 gave the
   * operator a switch for exactly that reason.
   */
  nonBindingDependencies: [
    {
      moduleId: 'mfa',
      name: 'mfaLoginPort',
      kind: 'degrades-without',
      whenAbsent:
        'Admin sign-in stops asking for a second factor and offers no Google/Microsoft button. ' +
        'Every admin has a password a peer admin can reset, so no admin is locked out.',
      reason:
        'AdminAuthService verifies the password first and then asks the second factor what to ' +
        'do. With `mfa` absent it asks nobody: `backend.ts` probes ' +
        '`effectiveState.isPresent("mfa")` and passes `undefined`, which selects the ' +
        'password-only branch feature 042 FR-033 requires and this service has always had. ' +
        'Nothing catches `ModuleDisabledError` — the decision is taken before the port is ' +
        'resolved, so the degrade is declared rather than laundered out of a closed gate. ' +
        'Enrolled secrets, recovery codes and every policy value stay in the database and ' +
        'apply again on the way back, which is what the activation control promises. Admin ' +
        'accounts are never auto-created and always carry a human-chosen password a peer ' +
        'admin can reset, so no admin becomes unreachable while the module is off.',
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
