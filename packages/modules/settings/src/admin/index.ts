/**
 * `settings`' admin surface — three routes and one sidebar entry, declared by
 * the module that owns them (feature 091, Phase 4, batch 10;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **One row, three tabs** since issue #1550 (UX audit SHELL-10): Settings,
 * Groups and Cache & search index are one place with three views, so the
 * sidebar carries `/settings` alone and `SettingsSectionTabs` switches between
 * them. The two other screens stay one ⌘K away through `open-setting-groups`
 * and `clear-cache` (Principle XVI), which is why their rows could go.
 *
 * **Three routes, not four, and the fourth is the point of this batch's
 * pairing.** `check:admin-registrations` attributed `/settings/pwa` here
 * because `App.tsx` imported `PwaPage` out of this module's surface directory,
 * and batch 6 recorded the consequence in as many words: the sidebar row moved
 * to `pwa` while the route stayed host-declared, so an operator who switched
 * `pwa` off still reached the screen and met the module's own 503 field by
 * field — *"unchanged by this batch and closes when `settings` moves"*. This is
 * that batch. `PwaPage`, `PushAudienceRuleBuilder` and `pwa-client.ts` are
 * `@endora-commerce/mod-pwa`'s now, and the route is declared beside the nav
 * entry that advertises it, gated on `pwa`'s presence rather than on this
 * module's.
 *
 * **The one reach this module still owed is paid, and both of its endpoints
 * are in this batch.** `ConfigurationReferenceInput` — the editor for the
 * `credential_ref` setting value type — imported `credentials`' admin API
 * client and its `ConfigurationPreviewModal`.  P6 took the client half; the
 * component half takes D-191's `./admin-ui` exit, decided by
 * `admin-component-contribution.md` Z1 from the signature rather than from
 * taste. The reach stays **counted** (Z11) and its ledger key is re-keyed
 * rather than retired: a supported spelling is not an uncounted one.
 *
 * **`nonDeactivatable`, so the operator axis is the platform's** (`plan.md`
 * Ruling 2). Every module's configuration resolves through this one, its own
 * activation control included, so a manifest that let an operator switch it off
 * would be a switch with nothing left to switch it back. The permission axis is
 * what it still has and is what the off-state test drives; the missing axis is
 * read off the manifest rather than skipped.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the grouped settings screen. */
const ROUTE_PATH = '/settings';

/**
 * The code that opens the settings screens.
 *
 * `GET /api/v1/admin/settings` and `GET /api/v1/admin/settings/groups` are both
 * `requireAdmin('settings:read')`, and this module's `open-settings` palette
 * action declares the same code — the pair
 * `check:action-route-permissions` holds to each other.
 */
const READ_PERMISSION = 'settings:read';

/**
 * The code the cache screen enforces.
 *
 * `POST /api/v1/admin/settings/cache/clear` and its siblings are
 * `requireAdmin('settings:write')`: the screen is a set of destructive buttons
 * and nothing else, so an operator holding only the read code would open a page
 * on which every control refuses. The codes are opaque strings, so the read
 * code does not satisfy this gate — which is the whole reason the sidebar row
 * carried the write code by hand before this conversion.
 */
const WRITE_PERMISSION = 'settings:write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/SettingsPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: `${ROUTE_PATH}/groups`,
      component: () => import('./pages/GroupsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/cache`,
      component: () => import('./pages/CachePage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/settings/i18n/`. These were `appShell.nav.settings`,
      // `appShell.nav.settingGroups` and `appShell.nav.cache` in the shared
      // `_i18n` bundle, three of the four shared files a module author had to
      // edit; the latter two rows are tabs now (issue #1550).
      labelKey: 'nav.settings.label',
      // The glyphs `AppShell.tsx` rendered by hand, both already on
      // `KnownIconNameSchema` — this module's `open-settings` action names
      // `Settings` too.
      icon: 'Settings',
      section: 'system',
      // The hand-written position in *System* times a hundred, which is batch
      // four's convention: `/settings` was the tenth row, between
      // `/credentials` (900, this batch) and `/settings/pwa` (1400, batch six).
      // `/settings/groups` (1100) and `/settings/cache` (1200) had rows of
      // their own until issue #1550 folded them into this one's tab strip.
      // *System* still holds host-declared entries (`/platform/modules`,
      // `/catalog/bulk-operations`), so `composeNav` appends every registry row
      // after both whatever the weight says; what the weight can still do is
      // keep the converted rows in the order the operator already had.
      weight: 1000,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
