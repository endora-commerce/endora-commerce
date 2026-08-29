/**
 * `import_export`'s admin surface — one route and one sidebar entry, declared
 * by the module that owns them (feature 091, Phase 2;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * Until this file existed, adding an admin screen meant editing
 * `admin/src/App.tsx` and `admin/src/components/AppShell.tsx` — two files no
 * module owns, which 11 of the 12 most recently added modules edited, so two
 * authors working in the same week collided even when the platform team changed
 * nothing (`spec.md` §1.1). `admin/src/modules.generated.ts` now imports this
 * object by the bare specifier this package's own `exports` map declares, and
 * the admin renders `[...host, ...registry]` through the one visibility
 * predicate it already had.
 *
 * **This entry exports data and nothing else** (R2). It may not export a
 * component, a hook or a service: `check:module-boundary`'s D-171 rule
 * designates a subpath as *contract surface* when it emits no runtime binding,
 * and `./admin` deliberately does not qualify — it exports an object — so a
 * consumer reaching into another module's `./admin` stays a counted boundary
 * reach, which is the correct answer.
 *
 * **The component is a dynamic-import factory, and it is the only
 * function-valued field** (R6). A static import would defeat FR-013 — an
 * operator downloads the page code of a module their role cannot reach — and
 * would make the registry evaluate React to be enumerated. Vite therefore emits
 * one chunk for this screen by construction rather than by a build rule.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The centre's one route. `catalog:write` is what its API routes enforce. */
const ROUTE_PATH = '/import-export';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ImportExportPage.js'),
      // The code `import_export`'s own admin routes are gated by
      // (`requireAdmin('catalog:write')`), read from the route rather than
      // copied from a neighbour — the rule `check:action-route-permissions`
      // already holds this module's two palette actions to, and which both of
      // them declare identically.
      requiredPermission: 'catalog:write',
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/import_export/i18n/`. It was `appShell.nav.importExport`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.importExport.label',
      icon: 'Upload',
      // Bulk operations span many domains, so the entry belongs under System
      // rather than to any one of them — the section it has always rendered in.
      section: 'system',
      // The weight the hand-written NAV gave it by position: between
      // `credentials` and `settings` in the System section.
      weight: 700,
      requiredPermission: 'catalog:write',
    },
  ],
};
