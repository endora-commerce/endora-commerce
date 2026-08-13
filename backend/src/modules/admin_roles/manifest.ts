import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin Roles module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'admin_roles',
  name: 'Admin Roles',
  description:
    'Admin RBAC — roles, permissions, and policy enforcement for admin sessions.',
  version: '1.0.0',
  dependencies: [],
  // Feature 072/073 (Constitution XVII) — `admin_roles` answers "may this admin
  // do this?" for every guarded route in the platform. Switched off, the
  // question has no answer and `requireAdmin` has nothing to check against, so
  // the correct behaviour would be to refuse every admin request — which is not
  // a deployment anyone wants and not a state the orchestrator will produce.
  activation: {
    nonDeactivatable: true,
    reason:
      'Answers the permission check behind every guarded admin route; switched off, no admin ' +
      'request could be authorised at all.',
  },
});
