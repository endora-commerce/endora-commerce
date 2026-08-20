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
   * closes a cycle — the mutual shape `acknowledgedDependencies` exists for.
   * With `customer_accounts` absent the resolution fails closed, so a signed-in
   * customer the platform cannot place in an Organization is refused rather than
   * bound to none — which is the cost of the edge, and the sort of thing a
   * reason can state without copying a fact the build re-derives (D-100).
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
        'customer_accounts, which declares auth — declaring it back closes a cycle. With ' +
        'customer_accounts absent the gated port refuses, so actor binding fails closed rather ' +
        'than treating a signed-in customer as belonging to no Organization.',
    },
  ],
  // D-44 — real to the container, binding on no operator.
  nonBindingDependencies: [
    {
      moduleId: 'api_keys',
      name: 'apiKeyResolver',
      kind: 'degrades-without',
      whenAbsent: 'requests presenting an API key are not authenticated',
      reason:
        'The request hook binds `request.actor` from a bearer API key when one is presented. ' +
        '`api_keys` declares this module, so the ordinary declaration closes a cycle, and ' +
        'acknowledging it would put `auth` — present in every deployment — among the ' +
        'dependents that refuse the flip, making an integration surface permanently ' +
        'unswitchable. The hook has a defined behaviour instead: it probes presence, and an ' +
        'API key presented to a deployment with the module off authenticates nobody, exactly ' +
        'as a request carrying no key does. Every session-authenticated request is untouched.',
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
