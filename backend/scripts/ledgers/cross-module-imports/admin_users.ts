/**
 * Cross-module imports still standing in `admin_users` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/admin_users/backend.ts:auth/services/mfa-login-port':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/backend.ts:auth/services/session-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/plugin.ts:admin_roles/services/admin-role-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/plugin.ts:admin_roles/services/permission-catalogue.service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/plugin.ts:admin_roles/services/permission-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/plugin.ts:auth/services/mfa-login-port':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/plugin.ts:auth/services/session-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.admin.ts:admin_roles/entities/admin-role.entity':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.admin.ts:admin_roles/services/admin-role-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.admin.ts:admin_roles/services/permission-catalogue.service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.admin.ts:admin_roles/services/permission-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.impersonation.ts:auth/plugin':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/routes.public.ts:auth/plugin':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/scripts/create-admin.ts:admin_roles/entities/admin-role.entity':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/scripts/create-admin.ts:auth/services/password-hasher':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/admin-auth-service.ts:auth/services/mfa-login-port':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/admin-auth-service.ts:auth/services/password-hasher':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/admin-auth-service.ts:auth/services/session-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/admin-user-service.ts:admin_roles/entities/admin-role.entity':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/admin-user-service.ts:auth/services/password-hasher':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/impersonation-service.ts:auth/services/session-service':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
  'modules/admin_users/services/impersonation-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — admin_users. Retired by the admin_users cut merge request.',
};
