/**
 * `assets_library`' admin surface — one route and one sidebar entry
 * (feature 091, Phase 4, batch 9;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain was thirteen incoming reaches and it is zero**, which is a
 * measurement rather than a claim. P4c (!1225) published `AssetPicker`,
 * `AssetUploader`, `AssetFieldPicker` and `toAbsoluteAssetUrl` into
 * `@endora-commerce/admin-kit` on the terms P2 set — each rebuilds its own
 * request from the published `apiClient` and the contract types, so nothing
 * that crosses those seams was ever this module's *code*. What is left under
 * `src/admin/` is the library screen itself, its folder tree, its detail drawer
 * and its typed client, and no module names any of them.
 *
 * **The drawer carried a fourteenth copy of `toAbsoluteAssetUrl` and P4c could
 * not see it.** That publication counted *cross-module* reaches, and a copy in
 * the owner's own file is not one — so the helper the kit publishes was
 * re-implemented, identically, in `AssetDetailDrawer.tsx`, over a private
 * `import.meta.env.VITE_API_BASE_URL` read with the same
 * `http://localhost:3001` fallback. The move forces the repair rather than
 * merely permitting it: this package's `tsconfig.ui.json` carries no
 * `vite/client` types, so `import.meta.env` does not compile here. It takes
 * `toAbsoluteAssetUrl` from `@endora-commerce/admin-kit/lib`, which is where
 * `LibraryPage` was already taking it from two files away.
 *
 * **No palette action, and that is asserted rather than skipped.** This module
 * declares none in its `manifest.ts` and this batch does not invent one:
 * choosing a landing action for a screen is a product decision, not a file
 * move — the reasoning batch 8 recorded for `seo` and `taxes`. The off-state
 * test drives the empty answer in both states, so an action added later without
 * a test fails.
 *
 * **`nonDeactivatable`, so the operator axis is the platform's** (`plan.md`
 * Ruling 2). Media storage is a platform primitive — product images, CMS media
 * and e-mail assets all resolve here — and the manifest says so with a reason.
 * The permission axis is what this module still has and is what the off-state
 * test drives; the missing axis is read off the manifest rather than skipped.
 *
 * **This entry exports data and nothing else** (R2); the component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: the three-pane library screen. */
const ROUTE_PATH = '/assets-library';

/**
 * The code `GET /api/v1/admin/assets` and the folder tree's reads enforce.
 *
 * The screen writes too — upload, rename, soft-delete — behind `assets.write`,
 * which is a second code this module declares and which is **not** what gates
 * the surface: an operator holding only `assets.read` opens the library and
 * sees the write affordances refuse. The nav entry and the route therefore
 * carry the read code, which is what `AppShell.tsx`'s hand-written row carried.
 */
const ASSETS_READ_PERMISSION = 'assets.read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/LibraryPage.js'),
      requiredPermission: ASSETS_READ_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/assets_library/i18n/`. It was
      // `appShell.nav.assetsLibrary` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.assetsLibrary.label',
      // The glyph `AppShell.tsx` rendered by hand (`Image as ImageIcon`), and
      // already on `KnownIconNameSchema`.
      icon: 'Image',
      section: 'catalog',
      // The hand-written table put `/assets-library` sixth of seven in
      // *Catalog*, directly above `/pim-ergonode`. `pim_pimcore` declares 300
      // to sit "immediately after `pim_ergonode`", so 200 keeps this row above
      // it and above `product_feeds`' 1000 — the order an operator already had
      // among the rows the registry contributes. All three still append after
      // the section's remaining host-declared rows, which is `composeNav`'s
      // behaviour until those carry weights too.
      weight: 200,
      requiredPermission: ASSETS_READ_PERMISSION,
    },
  ],
};
