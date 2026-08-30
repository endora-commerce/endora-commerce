/**
 * `admin_users`' admin surface — **two routes and one sidebar entry**, declared
 * by the module that owns them (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **`/admin-roles`' route is here and its sidebar row is `admin_roles`', and
 * that split is deliberate rather than an accident this batch preserved.** The
 * admin's two hand-written registries disagreed about one screen: `App.tsx`
 * imported `AdminRolesPage` out of `admin_users`' surface directory while
 * `AppShell.tsx`'s row declared `module: 'admin_roles'`. `plan.md`'s open
 * question 3 asked whether to force one attribution on both;
 * `backend/scripts/ledgers/admin-registrations.ts` had already answered it for
 * the ratchet — *"a route belongs to the module whose surface directory
 * `App.tsx` imports its component from, and a nav entry to the `module` field
 * it already carries"* — and the recommendation the plan makes is to keep
 * exactly that, because the two facts are two different true statements. The
 * screen is served by `GET /api/v1/admin/admin-roles` in **this** module's
 * `routes.admin.ts`, so this module ships the route; the sidebar row is the
 * *roles* capability's advertisement, so `admin_roles` ships that and the
 * palette action beside it. Both modules declare `nonDeactivatable`, so the
 * split is inert today and stops being inert the day either is unlocked — at
 * which point switching `admin_roles` off withdraws the sidebar row and the
 * palette entry while the deep link keeps working, which is the honest reading
 * of two modules that genuinely own two halves.
 *
 * **`admin_users:manage` gates all three declarations, and it is read from the
 * routes.** Every endpoint under `/api/v1/admin/admin-users` and
 * `/api/v1/admin/admin-roles` enforces that one code
 * (`packages/modules/admin_users/src/backend/routes.admin.ts`); there is no
 * separate read code and no `admin_roles:*` code anywhere in the platform.
 *
 * **The locked-with-nav shape.** Batch two rejected this module for declaring
 * `activation.nonDeactivatable`; `plan.md`'s Ruling 2 retires the ground and
 * puts the off-state proof on the permission axis, which
 * `useSurfaceVisibility` gates identically to presence —
 * `admin/test/modules/admin-users.module-owned-surface.test.tsx` and
 * `backend/test/integration/admin_users/off-state.test.ts`.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the admin-user list. */
const USERS_PATH = '/admin-users';

/**
 * The roles editor.
 *
 * Its route is this module's because the screen's API is; its sidebar entry and
 * its palette action are `admin_roles`'. See the note above.
 */
const ROLES_PATH = '/admin-roles';

export const contributions: AdminContributions = {
  routes: [
    {
      path: USERS_PATH,
      component: () => import('./pages/AdminUsersPage.js'),
      requiredPermission: 'admin_users:manage',
      index: true,
    },
    {
      path: ROLES_PATH,
      component: () => import('./pages/AdminRolesPage.js'),
      requiredPermission: 'admin_users:manage',
    },
  ],
  nav: [
    {
      to: USERS_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/admin_users/i18n/`. It was `appShell.nav.users` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.adminUsers.label',
      // The icon the hand-written NAV entry carried.
      icon: 'Users',
      section: 'system',
      // The hand-written table's position times a hundred — see the note in
      // `packages/modules/audit_logs/src/admin/index.ts`. `/admin-users` was
      // second of thirteen, ahead of `/admin-roles` (300) and `/audit-log`
      // (600), and that relative order is preserved.
      weight: 200,
      requiredPermission: 'admin_users:manage',
    },
  ],
};
