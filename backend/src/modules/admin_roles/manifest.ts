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
  /**
   * Feature 075, Phase C — the two reads of the `AdminUser` row became
   * `adminUserReadPort`, and `admin_users` declares this module, so declaring
   * it back in `dependencies` closes a cycle that `migration-order.ts` and the
   * composer generator both refuse. The mutual shape
   * `acknowledgedDependencies` exists for, and the same one `auth` records
   * against `customer_accounts`.
   *
   * It costs nothing on the refusal axis: `admin_users` is itself
   * `nonDeactivatable`, for the reason its own manifest gives — switched off,
   * nobody could sign in to switch it back on — so there is no flip for the
   * acknowledged edge to have refused.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'admin_users',
      port: 'adminUserReadPort',
      reason:
        'Answering "may this admin do this?" starts from the admin row — its role assignment ' +
        'and whether it is still live — and that row belongs to admin_users, which declares ' +
        'this module for the catalogue it reads back. Declaring it here closes a cycle. The ' +
        'owner is non-deactivatable, so the acknowledged edge adds no refusal that was not ' +
        'there.',
    },
  ],
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
