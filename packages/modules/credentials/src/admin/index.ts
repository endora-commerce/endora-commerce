/**
 * `credentials`' admin surface — two routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, batch 10;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **This is the batch's paying half.** `credentials` was 2-in / 0-out in the
 * re-derived table and both incoming reaches were one file — `settings`'
 * `ConfigurationReferenceInput.tsx`, which imported this module's admin API
 * client *and* its `ConfigurationPreviewModal`. P6 took the client half (the
 * caller builds `GET /api/v1/admin/credentials?type=…` from the published
 * `apiClient` and `ConfigurationListResponse`), and this batch takes the
 * component half, which is why `settings` and `credentials` move together: the
 * repair's two endpoints are both inside it, so neither module pays a reach
 * whose other end it is not moving.
 *
 * **The component half is `./admin-ui`, not the kit and not a zone.**
 * `admin-component-contribution.md` Z1 decides it from the signature —
 * `(open, configuration, onClose)` is a value in and a value back, question 1,
 * therefore a published component — and Z1.1's kit test refuses it because the
 * modal renders out of this module's own translation namespace. The reasoning
 * in full, including why the R-1 §9.2 remedy is wrong for this one, is in
 * `../admin-ui/index.ts`.
 *
 * **`/credentials/new` is a file rather than a prop.** `App.tsx` wrote
 * `element={<CredentialsPage initialMode="new" />}`; a route contribution's
 * `component` is a factory returning a module and the registry reads its
 * `default`, so there is nowhere to put an argument. `CredentialsNewPage` is
 * those two lines, held by the module instead of by the host, and it is the
 * `new-credential` palette action's destination.
 *
 * **Both routes leave `App.tsx` ungated and arrive gated**, which is batch
 * five's operator-visible repair arriving again: a host `<Route>` is the whole
 * of what `App.tsx` declares, so before this batch a deep link to
 * `/credentials` rendered the screen for any signed-in admin — and did so with
 * the module switched **off** — leaving the API to answer 403 or 503 field by
 * field. `ModuleRoute` gates both axes at the URL now.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach. `./admin-ui` does not qualify either, deliberately —
 * see Z11.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the configuration list. */
const ROUTE_PATH = '/credentials';

/**
 * The code that opens the screen.
 *
 * `GET /api/v1/admin/credentials` and `GET /api/v1/admin/credentials/types` are
 * both `requireAdmin('credentials:read')`, and the list fetches both on mount.
 * The screen writes too — create, edit, delete — behind `credentials:write`,
 * which is a second code this module declares and which is **not** what gates
 * the surface: an operator holding only the read code opens the list and sees
 * the write affordances refuse.
 */
const READ_PERMISSION = 'credentials:read';

/**
 * The code the create route enforces.
 *
 * `POST /api/v1/admin/credentials` is `requireAdmin('credentials:write')`, and
 * `/credentials/new` lands straight on the form — a screen whose only purpose
 * is a write. The codes are opaque strings, so an operator holding the read
 * code alone must not reach it; the module's own `new-credential` palette
 * action declares the same code, which is what `check:action-route-permissions`
 * holds the pair to.
 */
const WRITE_PERMISSION = 'credentials:write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CredentialsPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/CredentialsNewPage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/credentials/i18n/`. It was `appShell.nav.credentials`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.credentials.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's `open-credentials` action names
      // it too.
      icon: 'KeyRound',
      section: 'system',
      // The hand-written position in *System* times a hundred, which is batch
      // four's convention: `/credentials` was the ninth row of that section,
      // directly above the three `/settings*` rows this batch converts at 1000,
      // 1100 and 1200 and below `/webhooks` at 800. *System* still holds
      // host-declared entries (`/platform/modules`, `/catalog/bulk-operations`),
      // so `composeNav` appends every registry row after both whatever the
      // weight says; what the weight can still do is keep the converted rows in
      // the order the operator already had.
      weight: 900,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
