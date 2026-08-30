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
      section: 'system',
      // **The *System* section still holds host-declared entries**, unlike the
      // *Analytics & Ads* section batch three emptied, so this weight orders
      // the entry only against the other converted modules — the host block
      // renders first whatever any weight says, and that is the batch's one
      // operator-visible change. The scale is the hand-written table's own
      // position times a hundred, so the three entries this batch converts keep
      // the relative order they had (`/admin-users` 200, `/admin-roles` 300,
      // `/audit-log` 600) and the eight System entries still to convert have a
      // slot each waiting for them.
      weight: 600,
      // The code that opens the screen: the sidebar advertises a destination,
      // so it gates on what the landing route enforces.
      requiredPermission: 'audit_log:read',
    },
  ],
};
