/**
 * `transactional_emails`' admin surface — six routes and three sidebar
 * entries, declared by the module that owns them (feature 091, Phase 4, batch
 * 11; `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain is zero, re-derived on this branch before anything moved**, on
 * the same evidence as its batch partner: no shard in
 * `backend/scripts/ledgers/cross-module-imports/`, no key in
 * `admin-surface.ts`, none in `foreign-module-ids.ts`. The reaches the plan
 * recorded were into `admin/src/modules/_shared/email-builder/`, and P5b made
 * them stop existing rather than repairing them — they are bare specifiers
 * into `@endora-commerce/page-builder-admin/email` now.
 *
 * **`EmailEditorPane` here is this module's own and wraps the package's.** The
 * one in `components/` loads this module's blocks so the builder can offer
 * them as embeds, then delegates; the generic pane it delegates to is the
 * package's. Two names, one of them a thin adapter holding the module
 * knowledge the package must not have.
 *
 * **Two route files exist only to carry an argument.** `App.tsx` wrote
 * `element={<EmailFragmentEditor kind="block" />}` and its template twin; a
 * contribution declaration has nowhere to put a prop, so
 * `EmailBlockEditorPage` and `EmailTemplateEditorPage` hold the two lines the
 * host used to. That is batch 10's `CredentialsNewPage` decision arriving
 * twice.
 *
 * **One palette action is declared here for the first time** —
 * `open-email-blocks`, replacing the hand-written `PALETTE_ITEMS` row this
 * batch deletes, with the same destination, code and keywords.
 * `open-transactional-emails` and `open-email-templates` were already declared
 * and are untouched.
 *
 * **`nonDeactivatable`, so the operator axis is the platform's** (`plan.md`
 * Ruling 2). The manifest says why in its own words — this module is the
 * platform's only acknowledgement path to a buyer, and the granularity a
 * business wants is the individual e-mail, which `EmailsList` is the screen
 * for. The permission axis is what this module still has and is what the
 * off-state test drives; the missing axis is read off the manifest rather than
 * skipped.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the list of editable e-mails. */
const ROUTE_PATH = '/transactional-emails';

const BLOCKS_ROUTE = `${ROUTE_PATH}/blocks`;
const TEMPLATES_ROUTE = `${ROUTE_PATH}/templates`;

/**
 * The one code every screen below needs to open.
 *
 * All eight `GET`s under `/api/v1/admin/transactional-emails` enforce it —
 * the list, one e-mail, the blocks, the templates and the branding read — and
 * every screen gates its own saves on `transactional_emails:write` through
 * `useAuth().hasPermission`, which is the split the API already makes. It is
 * the code the three hand-written sidebar rows carried and the code both
 * declared palette actions carry.
 */
const READ_PERMISSION = 'transactional_emails:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/EmailsList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: BLOCKS_ROUTE,
      component: () => import('./pages/EmailBlocksPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${BLOCKS_ROUTE}/:id`,
      component: () => import('./pages/EmailBlockEditorPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: TEMPLATES_ROUTE,
      component: () => import('./pages/EmailTemplatesPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${TEMPLATES_ROUTE}/:id`,
      component: () => import('./pages/EmailTemplateEditorPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // Declared last, and it is the one route here whose order used to be
      // load-bearing: `/transactional-emails/:code` matches `/blocks` and
      // `/templates` too. `<Routes>` ranks by specificity rather than by
      // declaration order, so a static segment wins over a dynamic one — but
      // the ordering is kept anyway, because a reader should not have to know
      // that to see why the editor is safe here.
      path: `${ROUTE_PATH}/:code`,
      component: () => import('./pages/EmailEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/transactional_emails/i18n/`. It was
      // `appShell.nav.transactionalEmails` in the shared `_i18n` bundle, one of
      // the four shared files a module author had to edit.
      labelKey: 'nav.transactionalEmails.label',
      // The glyph `AppShell.tsx` rendered by hand for all three rows, and the
      // one this module's `open-transactional-emails` action already names.
      icon: 'Inbox',
      section: 'messaging',
      // The hand-written position times a hundred (batch four's convention).
      // *Messaging* holds no host row once these three leave, so the weights
      // are the whole order.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: BLOCKS_ROUTE,
      labelKey: 'nav.emailBlocks.label',
      icon: 'Inbox',
      section: 'messaging',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: TEMPLATES_ROUTE,
      labelKey: 'nav.emailTemplates.label',
      icon: 'Inbox',
      section: 'messaging',
      weight: 300,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
