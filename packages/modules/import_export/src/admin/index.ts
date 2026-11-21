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
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The centre's one route. */
const ROUTE_PATH = '/import-export';

/**
 * The codes the centre's API routes accept, any one of which opens it: each
 * entity is gated by its owning module's own read or write code, so an
 * operator who may export orders and nothing else still reaches the screen and
 * is offered the Orders card alone. Read from `requireAdminAny([...])` in
 * `backend/routes.ts`, not copied from a neighbour.
 */
const REQUIRED_PERMISSION = [
  'catalog:read',
  'catalog:write',
  'customers:read',
  'inventory:read',
  'inventory:write',
  'orders:read',
] as const;

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ImportExportPage.js'),
      requiredPermission: [...REQUIRED_PERMISSION],
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
      section: 'platform',
      // Issue #1519 (UX audit SHELL-11, DEC-02) split *System*: *Platform* is
      // how the instance is configured and extended, ordered with the host's
      // own rows by weight — Modules 100, Settings 200, Custom fields 300,
      // Import/export 400, Bulk operations 500, Webhooks 600, Global search
      // 700, PWA 800, Command hooks 900, API description 1000. Import and
      // export span many domains, so the row belongs to no one of them.
      weight: 400,
      requiredPermission: [...REQUIRED_PERMISSION],
    },
  ],
  zones: [
    // Issue #1455 (CAT-02) — *Import / export* on the products list header. The
    // centre's Products card is gated by catalog's own codes (`catalog:read` to
    // export, `catalog:write` to import), so those are what open the link.
    zoneComponent('product.list.actions', () => import('./zones/ProductListImportExportLink.js'), {
      requiredPermission: ['catalog:read', 'catalog:write'],
    }),
  ],
};
