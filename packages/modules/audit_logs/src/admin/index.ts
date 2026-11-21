/**
 * `audit_logs`' admin surface — one route and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The locked-with-nav shape, and the module batch one rejected by name.**
 * `plan.md`'s Ruling 2 retires the ground: `specs/deferred-defects.md` scopes
 * Constitution XVII item 6 to the modules that declare an
 * `activation.settingCode` *without* `nonDeactivatable`, so a locked module is
 * outside that population by the owner's own measurement rather than by an
 * exception anyone grants. Its off-state test asserts the axis it has — the
 * permission one, which `useSurfaceVisibility` gates identically — and asserts
 * the missing axis as a fact about the module read from the manifest, which is
 * a stronger statement than a skipped file.
 *
 * **`audit_log:read` is the code, singular, and it is read from the route.**
 * `GET /api/v1/admin/audit-log` enforces it
 * (`packages/modules/audit_logs/src/backend/routes.admin.ts`). The module's
 * other admin routes — the dashboard's recent-activity feed and the two
 * module-activation endpoints under
 * `routes.admin.recent-activity.ts` — are not this screen's, and two of them
 * enforce `platform.modules.activate`, so copying the neighbourhood would have
 * gated the viewer on a code that has nothing to do with reading an audit
 * trail.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only admin route: the append-only audit-log viewer. */
const ROUTE_PATH = '/audit-log';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/AuditLogViewer.js'),
      requiredPermission: 'audit_log:read',
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/audit_logs/i18n/`. It was `appShell.nav.auditLog` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.auditLog.label',
      // The icon the hand-written NAV entry carried.
      icon: 'ListChecks',
      section: 'access',
      // Issue #1519 (UX audit SHELL-11, DEC-02) split *System*: *Access* is who
      // may sign in and what they may do, in the order users, roles, API keys,
      // credentials, audit log (100 to 500). The record of what every identity
      // above did, last.
      weight: 500,
      // The code that opens the screen: the sidebar advertises a destination,
      // so it gates on what the landing route enforces.
      requiredPermission: 'audit_log:read',
    },
  ],
};
