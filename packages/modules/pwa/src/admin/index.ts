/**
 * `pwa`' admin surface — one route and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, batches six and ten;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The nav-only shape came first, and batch ten closed it.** Batch six moved
 * the sidebar entry alone, which was the half of `AdminContributions` nothing
 * had exercised — the type's own doc block says *"a module shipping only a nav
 * entry pointing at a host route is legal"* — and left the route in `App.tsx`
 * because `PwaPage` lived under `admin/src/modules/settings/pages/`, a
 * directory `settings` owns. That batch recorded the consequence rather than
 * hiding it: a host `<Route>` is ungated, so an operator who switched `pwa`
 * **off** still reached `/settings/pwa` and met this module's own 503 field by
 * field, *"unchanged by this batch and closes when `settings` moves"*.
 *
 * **`settings` moved in batch ten, so the screen came here.** `PwaPage`,
 * `PushAudienceRuleBuilder` and `pwa-client.ts` are this package's now and the
 * route is declared beside the entry that advertises it, gated on **this**
 * module's presence rather than on `settings`'. That is the `/admin-roles`
 * split of batch four resolving in the other direction: it existed because two
 * modules' code sat in one directory, and it ends when the directory does.
 * `admin/test/modules/pwa.module-owned-surface.test.tsx` is the proof, and it
 * kept an assertion from batch six that the advertisement's destination is a
 * route the admin declares somewhere — the route is this module's now.
 *
 * **`pwa` was batch four's sixth member and was deferred for a collision**,
 * not for a criterion — feature 087's Group B B2 was then in flight on this
 * package and both merge requests would have run `manifests:generate` over its
 * `package.json`. That work landed in `e12188dac`, so the collision is gone.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The screen's route, which is this module's own since batch ten.
 *
 * The **path** keeps the `/settings/` prefix it has had since feature 034: it
 * is where an operator's bookmarks point and where `pwa`'s own documentation
 * sends them, and moving a URL is a product change this conversion has no
 * reason to make. A path is not an ownership claim — `inpost`'s and the five
 * gateways' routes are `/settings/<id>` on the same terms.
 *
 * Spelled once so the route, the nav entry and the test that drives them cannot
 * drift.
 */
const NAV_TARGET = '/settings/pwa';

/**
 * The code that opens the screen.
 *
 * Every route under `GET /api/v1/admin/pwa/*` that this page calls on mount is
 * `requireAdmin('pwa:read')`. Its writes enforce `pwa:write` and
 * `pwa:send_push`, and neither of those opens it — the codes are opaque
 * strings, so declaring one of them would advertise a screen the operator
 * cannot read. It is the code the sidebar entry has carried since batch six,
 * and the route now carries the same one.
 */
const READ_PERMISSION = 'pwa:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: NAV_TARGET,
      component: () => import('./pages/PwaPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: NAV_TARGET,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/pwa/i18n/`. It was `appShell.nav.pwa` in the shared
      // `_i18n` bundle, one of the four shared files a module author had to
      // edit.
      labelKey: 'nav.pwa.label',
      // The icon the hand-written NAV entry carried. `Smartphone` joins
      // `KnownIconNameSchema` and the kit's `icon-map.ts` in this merge request
      // so the sidebar renders the same glyph it did before the move; swapping
      // to a name already on the allowlist would have been a visible change
      // bought for nothing.
      icon: 'Smartphone',
      section: 'system',
      // The hand-written table's position times a hundred — the convention
      // batch four set. `/settings/pwa` was fourteenth of fourteen in the
      // *System* section and 1400 keeps it last among the converted entries,
      // which are 200, 300, 600 and 700 today.
      weight: 1400,
      // The code enforced on the destination, which is the route declared
      // above — the two are one statement now rather than a module's guess
      // about a host registration.
      requiredPermission: READ_PERMISSION,
    },
  ],
};
