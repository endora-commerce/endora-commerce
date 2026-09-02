/**
 * `admin_roles`' admin surface — **one sidebar entry and no route of its own**,
 * declared by the module that owns it (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **This module ships a nav entry pointing at a route another module
 * declares**, which the registry supports by design —
 * `AdminContributions`' three arrays are each optional, and
 * `admin/test/lib/module-registry.test.ts` reads *"a module that contributes
 * only nav as contributing no route"* as legal. It is not a shortcut taken to
 * make a move cheap; it is the honest shape of a screen the two hand-written
 * registries have disagreed about since it was written: `App.tsx` imported
 * `AdminRolesPage` out of `admin_users`' surface directory while
 * `AppShell.tsx`'s row declared `module: 'admin_roles'`, and
 * `backend/scripts/ledgers/admin-registrations.ts` records both facts rather
 * than picking one.
 *
 * `plan.md`'s open question 3 recommended keeping exactly that attribution and
 * this is where the recommendation is made explicit. The **route** belongs to
 * `admin_users`, because the screen is served by
 * `GET /api/v1/admin/admin-roles` in that module's `routes.admin.ts` and the
 * component lives in its package; the **sidebar entry and the palette action**
 * belong here, because they advertise the roles capability, which is this
 * module's whole subject. Both modules declare `nonDeactivatable`, so nothing
 * an operator can do makes the split observable today. It stops being inert the
 * day either is unlocked: switching `admin_roles` off would withdraw the
 * advertisement and leave the deep link working, which is the right answer for
 * a module that owns the *roles* capability and not the screen that edits it.
 *
 * **`admin_users:manage`, not an `admin_roles:*` code.** This module registers
 * no admin route and declares no permission of its own, and the endpoints the
 * screen calls all enforce that one code
 * (`packages/modules/admin_users/src/backend/routes.admin.ts`). The comment the
 * hand-written NAV entry carried said so, and it survives the move rather than
 * being re-derived by whoever reads the declaration next. The module
 * attribution and the permission answer two different questions here, which is
 * why they are two fields.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The roles editor. `admin_users` declares the route; this is where it goes. */
const ROLES_PATH = '/admin-roles';

export const contributions: AdminContributions = {
  nav: [
    {
      to: ROLES_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/admin_roles/i18n/`. It was `appShell.nav.roles` in
      // the shared `_i18n` bundle, one of the four shared files a module author
      // had to edit.
      labelKey: 'nav.adminRoles.label',
      // The icon the hand-written NAV entry carried. It joins
      // `KnownIconNameSchema` and `icon-map.ts` in this merge request: a nav
      // entry names its glyph now, so keeping the one the sidebar already drew
      // meant adding the name rather than substituting one already on the list.
      icon: 'ShieldCheck',
      section: 'system',
      // The hand-written table's position times a hundred — see the note in
      // `packages/modules/audit_logs/src/admin/index.ts`. `/admin-roles` was
      // third of thirteen, directly after `/admin-users` (200), and that
      // relative order is preserved.
      weight: 300,
      requiredPermission: 'admin_users:manage',
    },
  ],
};
