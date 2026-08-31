/**
 * `pwa`' admin surface — one sidebar entry and no route, declared by the module
 * that owns it (feature 091, Phase 4, batch six;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The nav-only shape, and it is the reason this module is the batch.** Every
 * conversion so far has moved a route, with the sidebar entry — where there was
 * one — following the screen. `pwa` is the other half of the pair `mfa` and
 * `carts` proved for routes: `AdminContributions` says in as many words that
 * *"a module shipping only a nav entry pointing at a host route is legal"*, and
 * until now nothing exercised it. `admin/test/modules/pwa.module-owned-surface.test.tsx`
 * is that proof.
 *
 * **The route it points at stays in `App.tsx`, and that is not an oversight.**
 * `/settings/pwa` renders `PwaPage`, which lives in
 * `admin/src/modules/settings/pages/` — a directory `settings` owns — so
 * `check:admin-registrations` attributes the route to `settings` and this
 * module's baseline row has always read `{ routes: 0, nav: 1 }`. The screen and
 * its client are `pwa`'s by every other reading, but moving them is `settings`'
 * batch: they sit beside `PushAudienceRuleBuilder` and `pwa-client.ts` in that
 * module's directory, and a batch that took the screen without the directory
 * would leave `settings` reaching into a package for its own files. So this is
 * the split batch four made explicit for `/admin-roles`, arriving a second
 * time: the module that owns the capability declares the advertisement, the
 * module whose directory holds the component declares the route, and each says
 * so where it declares it.
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
 * The destination, which is a **host** route rather than one of this module's.
 * Spelled once so the declaration and the test that drives it cannot drift.
 */
const NAV_TARGET = '/settings/pwa';

export const contributions: AdminContributions = {
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
      // The code enforced on the destination: every route under
      // `GET /api/v1/admin/pwa/*` that opens this screen is
      // `requireAdmin('pwa:read')`. The screen's writes enforce `pwa:write` and
      // `pwa:send_push`, and neither of those opens it — the codes are opaque
      // strings, so declaring one of them would advertise the screen to an
      // operator who cannot read it.
      requiredPermission: 'pwa:read',
    },
  ],
};
