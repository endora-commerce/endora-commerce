/**
 * `newsletter`'s admin surface — eleven routes and six sidebar entries,
 * declared by the module that owns them (feature 091, Phase 4, batch 11;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain is zero, re-derived on this branch before anything moved.** The
 * plan's row for this batch predicted it and the derivation confirms it: no
 * key in `backend/scripts/ledgers/cross-module-imports/` (this module has no
 * shard at all), none in `admin-surface.ts`, none in `foreign-module-ids.ts`.
 * The debt the plan recorded was six reaches into
 * `admin/src/modules/_shared/email-builder/`, and P5b did not repair them — it
 * made them *stop existing*: the e-mail builder is
 * `@endora-commerce/page-builder-admin/email` now, so the six are bare
 * specifiers into a published `exports` map, which is what a package split
 * produces rather than a coupling it breaks.
 *
 * **The e-mail builder is reached as a peer, not as a sibling.** Three screens
 * — the campaign editor, the automation builder and the block editor — mount
 * `EmailEditorPane` and `EmailVariablesProvider` out of that package, and
 * `manifests:generate` derives the peer dependency from those specifiers
 * rather than from anybody remembering to add it. What stays this module's own
 * is `email-variables.ts`: a subscriber's address, an unsubscribe URL, a
 * web-view URL and a newsletter custom field are domain vocabulary, and all
 * three consumers are the screens below.
 *
 * **Two palette actions are declared here for the first time**, replacing the
 * hand-written `PALETTE_ITEMS` rows this batch deletes, with the same
 * destinations, codes and keywords. A hand-written palette row is a copy the
 * server was never asked about — it went on advertising the screen after an
 * operator withdrew the module — and this module is one an operator really can
 * withdraw. `open-newsletter` and `new-newsletter-campaign` were already
 * declared and are untouched.
 *
 * **This module is switchable**, unlike batch 10's `settings` and
 * `dictionaries`: `activation.settingCode` is `newsletter.enabled`, default
 * on. So the off-state proof drives both axes — the operator's and the
 * platform's — rather than the permission axis alone.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the subscriber list its palette action opens. */
const SUBSCRIBERS_ROUTE = '/newsletter/subscribers';

const CAMPAIGNS_ROUTE = '/newsletter/campaigns';
const AUTOMATIONS_ROUTE = '/newsletter/automations';
const TAGS_ROUTE = '/newsletter/tags';
const BLOCKS_ROUTE = '/newsletter/blocks';
const PROVIDER_ROUTE = '/newsletter/provider';

/**
 * The code every list and editor screen needs to open, and the one every `GET`
 * under `/api/v1/admin/newsletter` enforces.
 */
const READ_PERMISSION = 'newsletter:read';

/**
 * The code the screens that exist only to write carry.
 *
 * `/newsletter/campaigns/new` and `/newsletter/automations/new` have no `GET`
 * behind them at all — a blank form whose only outcome is a `POST`, which the
 * API gates on this code — so read is not enough to reach them. It is the code
 * `new-newsletter-campaign` already declares, and the code the hand-written
 * sidebar row for `/newsletter/provider` already carried: that screen is the
 * sending provider's configuration, and advertising it to an operator who
 * cannot change it was never the shell's intent.
 */
const WRITE_PERMISSION = 'newsletter:write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: SUBSCRIBERS_ROUTE,
      component: () => import('./pages/SubscribersPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: CAMPAIGNS_ROUTE,
      component: () => import('./pages/CampaignsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${CAMPAIGNS_ROUTE}/new`,
      component: () => import('./pages/CampaignEditor.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      // The editor on an existing campaign opens on a `GET` and gates its own
      // save on `newsletter:write` through `useAuth().hasPermission`, so read
      // is the honest code for reaching it — the same split the API makes.
      path: `${CAMPAIGNS_ROUTE}/:id`,
      component: () => import('./pages/CampaignEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${CAMPAIGNS_ROUTE}/:id/stats`,
      component: () => import('./pages/CampaignStats.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: AUTOMATIONS_ROUTE,
      component: () => import('./pages/AutomationsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${AUTOMATIONS_ROUTE}/new`,
      component: () => import('./pages/AutomationBuilder.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${AUTOMATIONS_ROUTE}/:id`,
      component: () => import('./pages/AutomationBuilder.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: TAGS_ROUTE,
      component: () => import('./pages/TagsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: BLOCKS_ROUTE,
      component: () => import('./pages/BlocksPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: PROVIDER_ROUTE,
      component: () => import('./pages/ProviderSettingsPage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
  ],
  nav: [
    {
      to: SUBSCRIBERS_ROUTE,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/newsletter/i18n/`. It was
      // `appShell.nav.newsletterSubscribers` in the shared `_i18n` bundle, one
      // of the four shared files a module author had to edit.
      labelKey: 'nav.subscribers.label',
      // The glyph `AppShell.tsx` rendered by hand for all six rows.
      icon: 'Inbox',
      section: 'newsletter',
      // The hand-written position times a hundred, which is batch four's
      // convention. *Newsletter* holds no host row at all once these six
      // leave, so the weights are the whole order rather than a tie-break
      // after one.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: CAMPAIGNS_ROUTE,
      labelKey: 'nav.campaigns.label',
      icon: 'Inbox',
      section: 'newsletter',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: AUTOMATIONS_ROUTE,
      labelKey: 'nav.automations.label',
      icon: 'Inbox',
      section: 'newsletter',
      weight: 300,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: TAGS_ROUTE,
      labelKey: 'nav.tags.label',
      icon: 'Inbox',
      section: 'newsletter',
      weight: 400,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: BLOCKS_ROUTE,
      labelKey: 'nav.blocks.label',
      icon: 'Inbox',
      section: 'newsletter',
      weight: 500,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: PROVIDER_ROUTE,
      labelKey: 'nav.provider.label',
      icon: 'Inbox',
      section: 'newsletter',
      weight: 600,
      // The code the hand-written row carried, kept: this row advertises the
      // provider configuration, not a read-only screen.
      requiredPermission: WRITE_PERMISSION,
    },
  ],
};
