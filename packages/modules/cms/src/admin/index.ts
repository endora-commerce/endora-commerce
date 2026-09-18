/**
 * `cms`' admin surface — eleven routes and four sidebar entries (feature 091,
 * Phase 4 batch 16).
 *
 * **The heaviest owner in the table, and the last to move.** With `blog` beside
 * it these eighteen routes and seven nav entries are the last module-owned
 * registrations `admin/src/App.tsx` and `admin/src/components/AppShell.tsx`
 * hold, which is SC-007.
 *
 * **This module publishes a component as well as contributing a surface**, and
 * that is what makes it batch 16's one judgement rather than its largest
 * directory. `blog`'s two editors render `PageBuilderEditor`, which is `cms`'
 * screen — the two keys in
 * `backend/scripts/ledgers/cross-module-imports/blog.ts`. Both endpoints are in
 * this batch, so the seam was decided here rather than inherited: Z1 reads the
 * signature, the signature is `data` in and `onChange` back, so the **consumer**
 * decides that the canvas appears and the exit is a published component. It is
 * on `./admin-ui` — D-191's subpath, `credentials`' exit from batch 10 — and
 * `src/admin-ui/index.ts` carries the whole of that reasoning, including why
 * the kit and `@endora-commerce/page-builder-admin` both refuse it and why the
 * two ledger keys are re-keyed rather than retired.
 *
 * **Eleven `admin/src` files go with the move and are not this module's**: the
 * nine re-export shims P5b left at
 * `admin/src/modules/cms/components/…` pointing into
 * `@endora-commerce/page-builder-admin`, and the two P8 left pointing into
 * `@endora-commerce/admin-kit/components` (`ContentLanguageTabs`,
 * `ScopePicker`). A shim exists so that the files still under `admin/src` reach
 * a moved binding by the specifier they always used; with the last of those
 * files here, the shims have no reader and the screens name the packages
 * directly.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens every screen below.
 *
 * `packages/modules/cms/src/backend/routes.admin.ts` gates every `GET` with
 * `cms.read` and every mutation with `cms.write`, and it is the read code that
 * opens a screen (issue #232) — the code all four hand-written sidebar rows
 * carried.
 *
 * **The three `/new` routes take the write code**, for the reason
 * `packages/modules/blog/src/admin/index.ts` records at length: this module's
 * `new-page` action advertises `/cms/pages/new` under `cms.write`, and a
 * read-gated create route would make the palette advertise a screen the
 * advertised code cannot open. The three create buttons are gated on the same
 * code, so the link is not a dead end.
 */
const READ_PERMISSION = 'cms.read';

/** The code the three create forms open on, and the one their saves enforce. */
const WRITE_PERMISSION = 'cms.write';

/** The module's landing route: the page list. */
const ROUTE_PATH = '/cms/pages';

export const contributions: AdminContributions = {
  routes: [
    {
      // The bare section path, which `App.tsx` has rendered onto the page list
      // since the CMS screens were written. It is kept as a second declaration
      // of the same component rather than turned into a redirect: a redirect
      // would be the admin application's own route — that is how
      // `check:admin-registrations` once attributed `/settings/dhl-parcel` —
      // and moving a `cms` deep link into the host's registry is the direction
      // this feature exists to reverse.
      //
      // **That precedent has since been withdrawn rather than extended**:
      // feature 134's wave 1 deleted the `/settings/dhl-parcel` redirect,
      // because attributing by *element* left the host declaring a route whose
      // *destination* only a departing module declares. The conclusion here is
      // unchanged and better supported than it was — keeping both ends with
      // `cms` is right for exactly the reason the redirect case went on to
      // prove.
      path: '/cms',
      component: () => import('./pages/PagesListPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: ROUTE_PATH,
      component: () => import('./pages/PagesListPage.js'),
      requiredPermission: READ_PERMISSION,
      // The landing route is the one the sidebar points at, which is
      // `/cms/pages` and not `/cms`.
      index: true,
    },
    {
      // Declared before `/cms/pages/:id`, as `App.tsx` declared it, for the
      // reason recorded in `blog`'s declaration: `<Routes>` ranks by
      // specificity, so the ordering is a reader's convenience rather than a
      // correctness condition.
      path: `${ROUTE_PATH}/new`,
      component: () => import('./editors/PageEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./editors/PageEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/cms/blocks',
      component: () => import('./pages/BlocksListPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/cms/blocks/new',
      component: () => import('./editors/BlockEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: '/cms/blocks/:id',
      component: () => import('./editors/BlockEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/cms/templates',
      component: () => import('./pages/TemplatesListPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/cms/templates/new',
      component: () => import('./editors/TemplateEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: '/cms/templates/:id',
      component: () => import('./editors/TemplateEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/cms/hooks',
      component: () => import('./pages/HooksPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), out of `packages/modules/cms/i18n/`. It was
      // `appShell.nav.cmsPages` in the shared `_i18n` bundle.
      labelKey: 'nav.cmsPages.label',
      icon: 'Newspaper',
      section: 'content',
      // First to fourth of eight in the hand-written *Content* table.
      // `megamenu` has declared 500 since batch 8 against a comment saying it
      // sits after these four and before `blog`'s three; 100–400 here and
      // 600–800 there are what make that comment true again.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/cms/blocks',
      labelKey: 'nav.cmsBlocks.label',
      icon: 'Newspaper',
      section: 'content',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/cms/templates',
      labelKey: 'nav.cmsTemplates.label',
      icon: 'Newspaper',
      section: 'content',
      weight: 300,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/cms/hooks',
      // The one row of the four with a glyph of its own, and it is kept: a
      // unified icon would be an operator-visible change bought for nothing.
      labelKey: 'nav.cmsHooks.label',
      icon: 'Webhook',
      section: 'content',
      weight: 400,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
