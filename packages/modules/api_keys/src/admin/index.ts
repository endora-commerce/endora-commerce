/**
 * `api_keys`' admin surface — one route and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, the plan's batch 6;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The batch this module belongs to was unblocked by P2 rather than chosen by
 * size.** `plan.md`'s sequence table records this module's drain as **2**, the
 * highest of the three, and both keys were `ApiKeysPage.tsx`'s reaches into
 * `admin/src/components/organization-picker` and
 * `admin/src/components/sales-channel-picker` — Group A entries in
 * `backend/scripts/ledgers/admin-surface.ts`, retired when those pickers became
 * `@endora-commerce/admin-kit/components`'. The screen names the published
 * components now, so this batch pays no reach of its own.
 *
 * **`CustomerPicker` was never a Group A key and is worth saying so.** The
 * screen reaches it too, and it has been the kit's since Phase 1b — it builds
 * its own request from the published `apiClient`, which is the exit P2 took for
 * the other three. It is in no ledger because there is nothing to ledger.
 *
 * **The permission the screen is gated on is shared with `webhooks`.**
 * `integrations:manage` guards every route in both modules' admin surfaces and
 * both manifests declare it (issue #213), so the code stays grantable while
 * either surface is on. That is why this entry names the same code the API
 * enforces rather than an `api_keys:`-prefixed one that does not exist.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 *
 * **The component is a dynamic-import factory** (R6), so Vite has a split point
 * whether or not anybody remembers to ask for one.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: issuing, binding and revoking machine keys. */
const ROUTE_PATH = '/api-keys';

/**
 * The code every route of this module's admin API enforces —
 * `requireAdmin('integrations:manage')` on `GET /api/v1/admin/api-keys` and on
 * each of its siblings. It is the same code the module's `open-api-keys`
 * palette action declares, which `check:action-route-permissions` holds to this
 * very route.
 */
const PERMISSION = 'integrations:manage';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ApiKeysPage.js'),
      requiredPermission: PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/api_keys/i18n/`. It was `appShell.nav.apiKeys` in the
      // shared `_i18n` bundle, one of the four shared files a module author had
      // to edit.
      labelKey: 'nav.apiKeys.label',
      // The glyph `AppShell.tsx` rendered by hand, and one already on the
      // allowlist — `credentials`' row renders it too.
      icon: 'KeyRound',
      section: 'system',
      // The hand-written position in *System* times a hundred, which is batch
      // four's convention: `/api-keys` was the seventh row of that section
      // before the drain began, one above `/webhooks`. *System* still holds
      // host-declared entries, so `composeNav` appends every registry row after
      // all of them whatever the weight says — what the weight can still do is
      // keep the converted rows in the order the hand-written table had.
      weight: 700,
      requiredPermission: PERMISSION,
    },
  ],
};
