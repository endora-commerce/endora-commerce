/**
 * Cross-module imports still standing in `blog` (feature 075, FR-022…FR-026).
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
  'modules/blog/backend.ts:assets_library/services/reference-registry':
    'F3 Phase C — blog. Retired by the blog cut merge request.',
  'modules/blog/services/blog-asset-references.ts:assets_library/services/reference-registry':
    'F3 Phase C — blog. Retired by the blog cut merge request.',
  'modules/blog/services/seed-roles.ts:admin_roles/services/admin-role-service':
    'F3 Phase C — blog. Retired by the blog cut merge request.',
};
