import { defineModuleManifest } from '@b2b/contracts';

/**
 * Auth module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'auth',
  name: 'Auth',
  description:
    'Authentication primitives — session cookies, bearer-token resolution, and request actor binding.',
  version: '1.0.0',
  // Feature 072, D-32 — `auth` owns the one `requireAdmin` implementation, and
  // that guard checks a permission through `admin_roles`' PermissionService.
  // The edge existed in the code long before it existed in the manifest; it is
  // one of the 261 imported-but-undeclared dependencies F3 will finish fixing.
  dependencies: ['admin_roles'],
  /**
   * The customer-organization lookup the request actor is bound with (issue
   * #90). `customer_accounts` owns it and declares `auth`, so declaring it back
   * closes a cycle — the mutual shape `acknowledgedDependencies` exists for. It
   * costs nothing on the refusal axis: `customer_accounts` is itself
   * `nonDeactivatable`, for reasons its own manifest spells out.
   *
   * The read stayed invisible until `check-port-dependencies` learned to follow
   * a module-local cradle alias, which is how a real port edge in the request
   * hook of the one module every request passes through went undeclared.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'customer_accounts',
      port: 'customerOrgResolver',
      reason:
        'Binding request.actor for a signed-in customer resolves their Organization through ' +
        'customer_accounts, which declares auth — declaring it back closes a cycle. The owner ' +
        'is non-deactivatable, so the acknowledged edge adds no refusal that was not there.',
    },
  ],
  // Feature 072/073 (Constitution XVII) — `auth` resolves `request.actor` for
  // every request and owns the `requireAdmin` port that gates 205 call sites in
  // 60 modules. A deployment with it switched off has no admin surface and no
  // customer session, which is not a smaller platform but a broken one. The
  // orchestrator refuses to disable it, with no `--force`.
  activation: {
    nonDeactivatable: true,
    reason:
      'Resolves the actor for every request and owns the requireAdmin guard; switched off, the ' +
      'platform has no admin surface and no customer sessions.',
  },
});
