/**
 * `blog`'s admin surface — seven routes and three sidebar entries (feature 091,
 * Phase 4 batch 16).
 *
 * **This is one of the two modules that close the drain.** `blog` and `cms` are
 * the last owners in `backend/scripts/ledgers/admin-registrations.ts`, so the
 * eighteen routes and seven nav entries they take out of `admin/src/App.tsx`
 * and `admin/src/components/AppShell.tsx` are the last module-owned
 * registrations those two files hold — SC-007.
 *
 * **What it drains: two keys, re-keyed rather than retired, and the difference
 * is the batch's one judgement.** `BlogPostEditor` and `BlogCategoryEditor`
 * each render `cms`' `PageBuilderEditor`; those are the two entries in
 * `backend/scripts/ledgers/cross-module-imports/blog.ts`, and both endpoints of
 * the reach are in this batch. `admin-component-contribution.md` Z1 decides the
 * exit from the **signature** rather than from the schedule, and this batch
 * re-read the file rather than inheriting the shard's answer: the props are
 * `data` in and `onChange` back, so the **consumer** decides that the canvas
 * appears — Z1 question 1, a published component, not a zone contribution. The
 * publication is D-191's `./admin-ui` subpath on `cms`' own package, and Z11
 * keeps the reach counted: a subpath is contract surface iff its emitted module
 * exports no runtime binding, and `dist/admin-ui/index.js` exports a React
 * component. So the coupling has a supported spelling and is not thereby
 * uncounted, and the shard's own retiring condition — D-192's page-builder
 * family growing a home for the whole builder — is unchanged and is not this
 * merge request's.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The code that opens every screen below.
 *
 * `packages/modules/blog/src/backend/routes.admin.ts` gates every `GET` with
 * `blog.read` and every mutation with `blog.write`, and it is the read code
 * that opens a screen — issue #232's rule, and the code all three hand-written
 * sidebar rows carried.
 *
 * **The two `/new` routes take the write code instead**, which is batch 14's
 * `/sales-channels/new` shape and is forced rather than chosen. This module's
 * `new-post` palette action advertises `/blog/posts/new` under `blog.write`;
 * declaring that route on the read code would make the palette advertise a
 * screen the advertised code cannot open — Principle XVI item 2's exact
 * prohibition, and a **regression** rather than a status quo, because the route
 * is ungated in `App.tsx` today and a `blog.write` operator reaches it. A
 * create form's only purpose is a write, so the write code is also the honest
 * answer for what opens it.
 *
 * It costs the other half batch 14 paid: a link whose destination the
 * operator's codes cannot open answers the admin's not-found page, which says
 * nothing about permissions, so the create affordances are gated on the same
 * code — the *New post* and *New category* buttons and the tree's *+ Child*,
 * beside `cms`' three. Neither module gated anything client-side before this;
 * `useAuth().hasPermission` is the kit's, and it is the predicate every other
 * converted module already uses.
 */
const READ_PERMISSION = 'blog.read';

/** The code the two create forms open on, and the one their saves enforce. */
const WRITE_PERMISSION = 'blog.write';

/** The module's landing route: the post list. */
const ROUTE_PATH = '/blog/posts';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/BlogPostListPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/blog/posts/:id`, as `App.tsx` declared it. `<Routes>`
      // ranks by specificity rather than by declaration order, so the static
      // segment wins whatever the order; the ordering is kept anyway, so a
      // reader does not have to know that to see why the editor route is safe
      // here.
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/BlogPostEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/BlogPostEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/blog/categories',
      component: () => import('./pages/BlogCategoryTreePage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/blog/categories/new',
      component: () => import('./pages/BlogCategoryEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: '/blog/categories/:id',
      component: () => import('./pages/BlogCategoryEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/blog/tags',
      component: () => import('./pages/BlogTagListPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/blog/i18n/`. It was `appShell.nav.blogPosts` in the
      // shared `_i18n` bundle, one of the four shared files a module author had
      // to edit.
      labelKey: 'nav.blogPosts.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema`.
      icon: 'Newspaper',
      section: 'content',
      // Sixth, seventh and eighth of eight in the hand-written *Content* table,
      // after the four `/cms/…` rows (100–400) and `megamenu`'s row, which has
      // declared 500 since batch 8 with a comment saying it sits *"after the
      // four `/cms/…` rows and before the three `/blog/…` ones"*. These three
      // weights are what makes that comment true again.
      weight: 600,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/blog/categories',
      labelKey: 'nav.blogCategories.label',
      icon: 'Newspaper',
      section: 'content',
      weight: 700,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/blog/tags',
      labelKey: 'nav.blogTags.label',
      icon: 'Newspaper',
      section: 'content',
      weight: 800,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
