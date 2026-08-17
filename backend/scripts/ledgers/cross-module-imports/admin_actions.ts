/**
 * Cross-module imports still standing in `admin_actions` (feature 075, FR-022…FR-026).
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
  'modules/admin_actions/backend.ts:_i18n/services/i18n-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/backend.ts:_lifecycle/services/manifest-loader':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/backend.ts:admin_roles/services/permission-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/plugin.ts:_i18n/services/i18n-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/plugin.ts:_lifecycle/services/manifest-loader':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/plugin.ts:admin_roles/services/permission-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/services/admin-actions-service.ts:_i18n/services/i18n-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
  'modules/admin_actions/services/admin-actions-service.ts:admin_roles/services/permission-service':
    'F3 Phase C — admin_actions. Retired by the admin_actions cut merge request.',
};
