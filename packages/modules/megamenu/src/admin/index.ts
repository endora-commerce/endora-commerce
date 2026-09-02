/**
 * `megamenu`'s admin surface — two routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain is zero and that is a measurement, not luck.** `plan.md`'s table
 * recorded three Group A keys for this module — an asset picker and two CMS
 * pickers — and P2 and P4c between them paid all three, in merge requests of
 * their own. Re-derived on the tree this batch was cut from: `megamenu` has no
 * shard in `backend/scripts/ledgers/cross-module-imports/`, no key in
 * `admin-surface.ts` names one of its files, and no other module's shard names
 * one either. The editor still renders a CMS page picker, a CMS block picker
 * and an asset field picker; all three are `@endora-commerce/admin-kit`'s now,
 * so none of them is a boundary reach.
 *
 * **Two routes, one nav entry, and the second route deliberately has none.**
 * `/megamenu/:id` is the editor a row on `/megamenu` leads to — a nav entry is
 * a landing surface, and `registryCrumbs` derives the editor's trail from this
 * entry's own `to` because it matches anything beneath it.
 *
 * **The palette action is already the manifest's** (`edit-megamenu`), so
 * nothing about the ⌘K surface moves here; the sidebar row is the whole of
 * what this file adds.
 *
 * **This entry exports data and nothing else** (R2); both components are
 * dynamic-import factories (R6), so the editor's chunk is not downloaded by an
 * operator who only lists menus.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the menu list. */
const LIST_ROUTE = '/megamenu';

export const contributions: AdminContributions = {
  routes: [
    {
      path: LIST_ROUTE,
      component: () => import('./pages/MegamenuListPage.js'),
      // `requireAdmin('megamenu.read')` on `GET /api/v1/admin/megamenu`, which
      // the list calls on mount.
      requiredPermission: 'megamenu.read',
      index: true,
    },
    {
      path: '/megamenu/:id',
      component: () => import('./pages/MegamenuEditor.js'),
      // The editor's own `GET /api/v1/admin/megamenu/:id` is read-gated: the
      // write code would hide the screen from a read-only operator who can
      // legitimately open it and be refused on save, which is issue #232's
      // finding. The palette action declares `megamenu.write` because it
      // advertises *editing*, and `check:action-route-permissions` holds it to
      // `/megamenu`, whose route requirement is the read code — sufficiency,
      // not equality, is what that check asks for.
      requiredPermission: 'megamenu.read',
    },
  ],
  nav: [
    {
      to: LIST_ROUTE,
      // Module-relative (R8), out of `packages/modules/megamenu/i18n/`. It was
      // `appShell.nav.megamenu` in the shared `_i18n` bundle.
      labelKey: 'nav.megamenu.label',
      // The glyph the hand-written NAV entry carried. The palette action
      // declares `Menu`, which is the icon for the *action*; the sidebar row's
      // is the one an operator already sees and is kept rather than unified,
      // because unifying it would be a visible change bought for nothing.
      icon: 'Newspaper',
      section: 'content',
      // Fifth of eight in the hand-written *Content* table, after the four
      // `/cms/*` rows and before the three `/blog/*` ones. Both neighbours are
      // still the host's, so this appends after all of them; the weight is what
      // restores the position once `cms` and `blog` convert.
      weight: 500,
      requiredPermission: 'megamenu.read',
    },
  ],
};
