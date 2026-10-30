import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap, useViewportTier } from '@endora-commerce/admin-kit/components';
import { BrandLogo } from './BrandLogo.js';
import { VersionBadge } from './VersionBadge.js';
import { AdminFeedback } from './AdminFeedback.js';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Home as HomeIcon,
  Menu,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  useAuth,
  cn,
  useModulePresence,
  useSurfaceVisibility,
  type GatedSurface,
  type PermissionRequirement,
  resolveIcon,
  useAdminPreference,
} from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  registryNavFor,
  useAdminRegistry,
  type AdminRegistryEntry,
} from '../lib/module-registry/index.js';
import { LanguagePicker } from './LanguagePicker.js';
import { RoleRequiredNotice } from './RoleRequiredNotice.js';
import { NotificationBell } from './notifications/index.js';
import { useAdminActions } from '../lib/admin-actions/useAdminActions.js';
import { matchesSearchTerms, searchTerms } from '../lib/palette-match.js';
import { usePlatformVersion } from '../lib/platform-info/usePlatformVersion.js';
import { getPromptCapability, listUnseenPromptRequests } from '../lib/prompt-actions/api.js';
import { PromptModePanel } from './prompt-actions/PromptModePanel.js';
import { useGlobalSearch } from '../lib/global-search/useGlobalSearch.js';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { SpeechToTextButton } from './SpeechToTextButton.js';
import type { PromptActionRequestDto } from '@endora-commerce/contracts';

import type { NavItem, NavSection } from './sidebar/nav-types.js';
import { PinnedSection } from './sidebar/PinnedSection.js';
import { PinToggleButton } from './sidebar/PinToggleButton.js';
import { PreferencesSaveNotice } from './sidebar/PreferencesSaveNotice.js';
import { usePinActions, type PinOutcome } from './sidebar/use-pin-actions.js';
import {
  reorderVisiblePins,
  resolvePinsFrom,
  visibleDestinations,
  type VisibleDestination,
} from '../lib/pinned-entries.js';

/* Design-aligned navigation. The "Home" + "Orders" cluster sits above
 * the first labelled group exactly as the prototype shows. */
const NAV: NavSection[] = [
  {
    key: 'main',
    labelKey: '',
    items: [
      { to: '/', labelKey: 'appShell.nav.home', icon: LayoutDashboard, module: null },
    ],
  },
  {
    key: 'sales',
    labelKey: 'appShell.section.sales',
    items: [
      // All three `/orders*` rows stood here until feature 091's Phase 4 batch
      // 15; `orders` declares them now, at weights 100, 200 and 300 — the order
      // they stood in — in `packages/modules/orders/src/admin/index.ts`. That
      // *quick order is not a second destination but the other way of getting
      // lines into the same order, so it lives behind a tab on the order-entry
      // page* is still true and is recorded where the routes are.
      //
      // `/quote-requests`, `/invoices` and `/ksef` were declared here until
      // feature 091's Phase 4 batch 12, at weights 400, 500 and 600 — the order
      // they stood in here, and still the order they render in now that the
      // three rows above them are contributions too.
      //
      // The section now holds **no host-declared row**, which has one
      // operator-visible consequence recorded rather than glossed: the
      // breadcrumb `registryCrumbs` derives for every screen in it renders
      // *Sales* unlinked, because there is no host entry left for it to point
      // at. That is batch 13's *Inventory* and *Pricing* arriving again, and it
      // reaches the four contributed rows' trails as well as this module's own.
      //
      // `/ksef`'s glyph changes from `ReceiptText` to `Receipt`:
      // `KnownIconNameSchema` does not carry the first, and `Receipt` is what
      // this module's own `open-ksef` palette action has always named.
    ],
  },
  {
    // The CRM group (owner ruling of 2026-10-05,
    // `specs/143-crm-sales-opportunities/` research R-19). It holds no
    // host-declared row and never will: every entry is the `crm` module's
    // contribution, so the heading renders only while that module is present
    // and the operator may see one of its entries.
    key: 'crm',
    labelKey: 'appShell.section.crm',
    items: [],
  },
  {
    // The "Projects & tasks" group (`specs/163-projects-and-tasks/` research
    // R-16). It holds no host-declared row: every entry is the `projects` or
    // the `tasks` module's contribution, each gated by its own module's
    // permission, so the heading shows only Tasks entries while `projects` is
    // off and disappears when both modules are.
    key: 'work',
    labelKey: 'appShell.section.work',
    items: [],
  },
  {
    key: 'catalog',
    labelKey: 'appShell.section.catalog',
    items: [
      // All five `/catalog*` rows stood here until feature 091's Phase 4 batch
      // 15; `catalog` declares them now, in
      // `packages/modules/catalog/src/admin/index.ts`, at weights 10 to 50 —
      // ten times the position rather than the usual hundred, because this
      // section already holds three contributed rows and every one of them
      // belongs *below* these five. `assets_library` declares 200, so
      // `/catalog/categories` at 200 would tie with it and lose the tie-break
      // on module id.
      //
      // The section now holds **no host-declared row**, so the derived
      // breadcrumb renders *Catalog* unlinked — including on `pim_ergonode`'s
      // five trails, whose own note recorded that crumb keeping its
      // `/catalog/products` href while these rows were the host's.
      //
      // `/pim-ergonode` stood here until feature 091's Phase 4 batch 13.
      // `pim_ergonode` declares it now, at weight 250 — between
      // `assets_library`' 200 and `pim_pimcore`' 300, which is where both of
      // those rows' own comments already said this one belonged and could not
      // be while it was the host's, `composeNav` appending every registry entry
      // after every host one. The reasoning that keeps it *one* row for five
      // screens — the other four are reached through the tab strip on the
      // connector page — is recorded where the routes are, in
      // `packages/modules/pim_ergonode/src/admin/index.ts`.
      //
      // Feature 068's placement note stands and is why the section is *Catalog*
      // rather than *Channels*: it is where catalogue content comes *from*, and
      // the three surfaces it writes are its neighbours here.
    ],
  },
  {
    key: 'inventory',
    labelKey: 'appShell.section.inventory',
    items: [
      // All five rows of this section stood here until feature 091's Phase 4
      // batch 13; `inventory` declares them now, at weights 100 to 500 — the
      // order they stood in — in
      // `packages/modules/inventory/src/admin/index.ts`. The codes those
      // declarations carry are the ones this table settled on 2026-08-29, when
      // every one of the five stopped naming a module that owns none of the
      // data behind them (`orders:read` for four screens about warehouses and
      // stock, `catalog:write` for the CSV importer), and the importer keeps
      // the `inventory:write` that separates it from the other four.
      //
      // The section now holds **no host-declared row**, which has one
      // operator-visible consequence recorded rather than glossed: the
      // breadcrumb `registryCrumbs` derives for these screens renders
      // *Inventory* unlinked, because there is no host entry left for it to
      // point at. That is batch 11's *Messaging* arriving a second time.
    ],
  },
  {
    key: 'pricing',
    labelKey: 'appShell.section.pricing',
    items: [
      // `/price-lists` stood here until feature 091's Phase 4 batch 13.
      // `price_lists` declares it now, at weight 100 — first in this section,
      // which is where the operator has always seen it, and which is the whole
      // of what keeps it above `taxes`' and `promotions`' 200 now that the host
      // declares no row here at all. The same *Inventory* consequence applies:
      // the derived breadcrumb renders *Pricing* unlinked.
      //
      // Carrier / payment gateway settings are reached as integrations from the
      // Delivery methods / Payment methods pages (not top-level sidebar).
    ],
  },
  {
    key: 'customers',
    labelKey: 'appShell.section.customers',
    items: [
      // `/customers`, `/customers/online` and `/organizations` stood here until
      // feature 091's Phase 4 batch 14; `/comparisons` left in batch 6,
      // `/customer-groups` in batch 7 and `/credit-limits` in batch 8. Every
      // row in this section is the registry's now, ordered by the weights the
      // four modules declare — 100, 200, 300, then 400 twice and 600 — which is
      // the order the operator already had.
      //
      // **The any-of gate travels with the row.** `/organizations` is gated by
      // `requireAdminAny(['customers:read', 'customers:manage'])`
      // (`packages/modules/organizations/src/backend/routes.admin.ts:169`), and
      // naming only the read code — as that entry did until 2026-08-29 — hid
      // the screen from a role holding just `customers:manage`.
      // `AdminNavDeclaration.requiredPermission` takes a `PermissionRequirement`
      // for exactly this, so the array is declared unchanged in
      // `packages/modules/organizations/src/admin/index.ts`.
      //
      // The section now holds **no host-declared row**, which has one
      // operator-visible consequence recorded rather than glossed: the
      // breadcrumb `registryCrumbs` derives for these screens renders
      // *Customers* unlinked, because there is no host entry left for it to
      // point at. That is batch 13's *Inventory* and *Pricing* arriving again.
    ],
  },
  {
    key: 'channels',
    labelKey: 'appShell.section.channels',
    items: [
      // `/sales-channels` stood here until feature 091's Phase 4 batch 14;
      // `/dictionary` and `/admin/dictionaries/audit` left in batch 10 and
      // `/seo` in batch 8. Every row in this section is the registry's now, and
      // `sales_channels` declares weight 100 against `dictionaries`' 200 and
      // 300 and `seo`'s 400 — which is the order this table gave them while the
      // first row was the host's and `composeNav` appended the rest. The
      // *Customers* consequence above applies here too: the section holds no
      // host-declared row, so the derived breadcrumb renders *Channels*
      // unlinked.
    ],
  },
  {
    key: 'content',
    labelKey: 'appShell.section.content',
    items: [
      // All seven rows of this section stood here until feature 091's Phase 4
      // batch 16 — the four `/cms/…` and the three `/blog/…` — and `/megamenu`
      // left in batch 8. `cms` and `blog` declare theirs now, at weights 100 to
      // 400 and 600 to 800, in
      // `packages/modules/{cms,blog}/src/admin/index.ts`. `megamenu` has
      // declared 500 since batch 8 with a comment saying it sits after the four
      // `/cms/…` rows and before the three `/blog/…` ones; it could not while
      // both neighbours were the host's and `composeNav` appended every
      // registry entry after every host one, and those seven weights are what
      // make it true again.
      //
      // The section now holds **no host-declared row**, with the one
      // operator-visible consequence every emptied section has: the breadcrumb
      // `registryCrumbs` derives for these screens renders *Content* unlinked,
      // because there is no host entry left for it to point at. That is batches
      // 13's *Inventory* and *Pricing* and 14's *Customers* and *Channels*
      // arriving one last time.
    ],
  },
  {
    key: 'messaging',
    labelKey: 'appShell.section.messaging',
    // **Empty on purpose** (feature 091, Phase 4 batch 11), which is
    // `analyticsAds`' shape below. All three entries — `/transactional-emails`
    // and its blocks and templates screens — are declared by
    // `transactional_emails` and arrive through `composeNav` from
    // `modules.generated.ts`. The section stays here because the shell owns the
    // section taxonomy: `composeNav` refuses a contribution naming a section
    // this file does not declare.
    //
    // With no host-declared entry left, the weights the module declares (100,
    // 200, 300) are the whole of this section's order and reproduce exactly the
    // order this table had.
    items: [],
  },
  {
    key: 'newsletter',
    labelKey: 'appShell.section.newsletter',
    // Empty on purpose, for the reason above and in the same batch: all six
    // entries are `newsletter`'s, declared at weights 100 through 600, which is
    // the order they stood in here.
    items: [],
  },
  // Reporting and paid-acquisition surfaces. They were originally filed under
  // System because each arrived as a lone integration, but together they are a
  // domain an operator navigates to on purpose — not a system setting.
  {
    key: 'analyticsAds',
    labelKey: 'appShell.section.analyticsAds',
    // **Empty on purpose, and the first section that is** (feature 091, Phase 4
    // batch three). All four of this section's entries — `/analytics`,
    // `/google-analytics`, `/linkedin-ads`, `/meta-ads` — are now declared by
    // the modules that own them and arrive through `composeNav` from
    // `modules.generated.ts`. The section itself stays here because the shell
    // owns the section taxonomy: `composeNav` refuses a contribution naming a
    // section this file does not declare, since an entry in a section nobody
    // renders is a surface that silently appears nowhere.
    //
    // The consequence is worth stating rather than discovering: with no
    // host-declared entry left, `registryNavFor`'s `weight` is the whole of
    // this section's order, and the weights the four modules declare (100, 200,
    // 300, 400) reproduce exactly the order the hand-written table had. Batch
    // one and batch two each recorded the append-to-the-end ordering as an
    // operator-visible regression; this is where it is repaired.
    items: [],
  },
  {
    key: 'system',
    labelKey: 'appShell.section.system',
    items: [
      // `module: null`, deliberately (D-36). This is the screen that switches
      // modules on and off; attributing it to a module would mean the surface
      // could switch itself out of existence, and nothing would be left to
      // switch it back. It is gated on a permission, never on presence.
      {
        to: '/platform/modules',
        labelKey: 'appShell.nav.platformModules',
        icon: Boxes,
        requiredPermission: 'platform.modules.read',
        module: null,
      },
      // `module: null` for the same reason: the API description covers every
      // module's routes, so no module's presence decides whether it is there.
      // Gated on the code its backing route enforces.
      {
        to: '/api-description',
        labelKey: 'appShell.nav.platformApiDescription',
        icon: BookOpen,
        requiredPermission: 'platform.api_description.read',
        module: null,
      },
      // `/admin-users`, `/admin-roles` and `/audit-log` are declared by the
      // modules that own them since feature 091's Phase 4 batch four, and
      // arrive through `composeNav` from `modules.generated.ts` — including the
      // split this file used to carry a comment about: the roles row is
      // `admin_roles`' while the screen it points at is `admin_users`'. Their
      // declarations, and that comment's reasoning, are in
      // `packages/modules/{admin_users,admin_roles,audit_logs}/src/admin/index.ts`.
      //
      // Unlike *Analytics & Ads*, this section still holds host entries, so a
      // registry entry appends after every one of them whatever its weight says
      // — the operator-visible consequence the batch records.
      // `/catalog/bulk-operations` stood here until feature 091's Phase 4 batch
      // 15; `catalog` declares it now, at weight 400 — its position in this
      // table's original thirteen rows, which is behind `/admin-roles`' 300 and
      // ahead of `/custom-fields`' 500. One operator-visible change follows and
      // is recorded rather than glossed: the row rendered *second* while it was
      // the host's, `composeNav` putting every host row above every contributed
      // one, and it renders fourth now — back where the table that wrote it put
      // it. That *bulk operations may span many domains, so the entry lives
      // under System while the URL stays `/catalog/bulk-operations` to keep
      // existing deep links valid* is recorded where the route is.
      // `/api-keys` and `/webhooks` are declared by the modules that own them
      // since feature 091's Phase 4 (the plan's batch 6), and arrive through
      // `composeNav` from `modules.generated.ts`. Their declarations are in
      // `packages/modules/{api_keys,webhooks}/src/admin/index.ts`.
      // `/credentials`, `/settings`, `/settings/groups` and `/settings/cache`
      // are declared by the modules that own them since feature 091's Phase 4
      // batch 10, and arrive through `composeNav` from `modules.generated.ts`.
      // Their declarations are in
      // `packages/modules/{credentials,settings}/src/admin/index.ts`.
      //
      // `/settings/pwa` is `pwa`'s and has been since batch six, when only the
      // advertisement moved because the screen lived under
      // `modules/settings/pages/`. Batch 10 moved that directory, so the screen
      // went with it and the route is `pwa`'s too — the split closes rather
      // than standing.
    ],
  },
];

/**
 * Map URL pathname → breadcrumb trail. Each crumb carries a label and
 * an optional `href`; the trailing segment (current page) carries
 * `null` so the renderer can disable it. Hrefs are picked so every
 * intermediate crumb routes the operator back to a useful list page
 * (e.g. "Catalog" → /catalog/products).
 */
/**
 * Either a translation key (preferred — resolved via `useTranslation('core')`)
 * or a verbatim literal (used by the URL-segment fallback when the path
 * doesn't match any CRUMB_DICT entry). The renderer picks whichever is set.
 *
 * The static CRUMB_DICT entries always set `labelKey` and reuse the
 * `appShell.nav.*` / `appShell.section.*` keys plus a small
 * `appShell.crumb.*` namespace for the editor / detail / new / edit
 * leaves that aren't represented in the side navigation.
 */
type Crumb =
  | {
      labelKey: string;
      /**
       * The i18n scope `labelKey` resolves in; absent means `'core'`.
       *
       * A module-contributed crumb (feature 091) carries the module id, so its
       * label comes out of the module's own bundle — the same split
       * {@link NavItem.labelScope} makes for the sidebar entry it mirrors.
       */
      labelScope?: string;
      literal?: undefined;
      href: string | null;
    }
  | { labelKey?: undefined; labelScope?: undefined; literal: string; href: string | null };

const CRUMB_DICT: Array<{ test: RegExp; build: (m: RegExpMatchArray) => Crumb[] }> = [
  { test: /^\/$/, build: () => [{ labelKey: 'appShell.nav.home', href: null }] },
  // Six hand-written `/catalog*` trails stood here until feature 091's Phase 4
  // batch 15, and the two `/catalog/bulk-operations*` screens never had one at
  // all — both fell to the humanised-segment fallback. `registryCrumbs` derives
  // all eight now, from the sidebar entries `catalog` declares. Three
  // operator-visible changes, stated rather than glossed:
  //
  //  - *Catalog* loses its link, this section holding no host-declared entry
  //    any more for `registryCrumbs` to point at (batch 13's *Inventory* and
  //    *Pricing*, arriving again).
  //  - `/catalog/products/:id` loses its *Editor* leaf and reads
  //    *Catalog → Products*, which is the shape every converted module's
  //    sub-screen already gets.
  //  - the two bulk-operation screens gain the label their sidebar row carries,
  //    under *System* rather than under *Catalog*, which is the section that row
  //    has declared since it was written.
  // Seventeen hand-written trails stood here until feature 091's Phase 4 batch
  // 13 — the five `/pim-ergonode*`, the four `/inventory*`, the three
  // `/warehouses*`, the two `/price-lists*` — plus `/orders/quick-order`, which
  // never had one and fell to the humanised-segment fallback.
  // `registryCrumbs` derives all of them now, from the sidebar entries the four
  // modules declare, which is what keeps a converted module's breadcrumb from
  // being a third shared file to edit. Four operator-visible changes, stated
  // rather than glossed:
  //
  //  - *Inventory* and *Pricing* lose their link, because neither section holds
  //    a host-declared entry any more for `registryCrumbs` to point at (batch
  //    11's *Messaging*, arriving again).
  //  - Ergonode's five trails were three crumbs deep and are two: the derived
  //    trail is *Catalog → <the entry's own label>*, and the leaf for the four
  //    sub-screens becomes *Ergonode PIM* linked to nothing, because a nav
  //    entry is a landing surface and these four have none of their own. The
  //    three `appShell.nav.pimErgonode*` keys and `appShell.crumb.importRun`
  //    that only these rules rendered are retired from `_i18n` with them.
  //  - `/warehouses/new` and `/warehouses/:id` lose their *New* and *Edit*
  //    leaves for the same reason, which is the shape every converted module's
  //    sub-screen already gets.
  //  - the *Catalog* crumb on the Ergonode trails keeps its `/catalog/products`
  //    href, that being the section's first host-declared entry — the same
  //    answer the hand-written rules gave.
  // The two carrier trails — `/delivery-methods/dhl-parcel` and
  // `/settings/inpost` — stood here until feature 134's wave 1 (FR-023, the
  // extraction's per-wave prologue W1). They are the first two of the seven
  // this table has left, and they retire for a reason the earlier batches did
  // not have: **a host-owned crumb table may not declare a trail whose
  // destination only a module declares.** Both routes are declared in
  // `dhl_parcel`'s and `inpost`'s own admin layers and nowhere else, so this
  // table was asserting a trail whose other end it cannot see — and a module
  // that ships separately from this package takes its route declarations with
  // it, at which point the rule describes nothing
  // (`specs/conventions/module-admin-surfaces.md`).
  // `registryCrumbs` derives both trails now. Three
  // operator-visible changes, stated rather than glossed:
  //
  //  - `/delivery-methods/dhl-parcel` loses its *DHL Parcel* leaf and reads
  //    *Pricing → Delivery methods*. Neither carrier contributes a sidebar
  //    entry and neither is given one — that is the carriers' own
  //    `plan.md` Ruling 1, and a nav row added to make a crumb derivable would
  //    be a product change bought for a breadcrumb — so there is no contributed
  //    row for `registryCrumbs` to build a leaf from. It is the shape every
  //    converted module's sub-screen already gets.
  //  - `/settings/inpost` reads *System → Settings*, and this one is **worse
  //    than it was**, not merely shorter. `registryCrumbs` takes the longest
  //    nav entry the path sits under, and `/settings/inpost` sits under
  //    `settings`' own `/settings` rather than under anything the carrier
  //    declares, so the trail names a screen the operator is not on. The route
  //    is `inpost`'s own declaration, and it is moot in any instance that does
  //    not install that module; the alternatives were giving `inpost` a sidebar
  //    row it has never had, or keeping a host rule whose destination only the
  //    module declares, and both are refused above.
  //  - three `_i18n` keys retire, not two: the carriers' own pair, and the
  //    shared **parent** key both trails named. That third one was kept out of
  //    batch 8's sweep *explicitly* to parent these two trails —
  //    `packages/modules/delivery_methods/src/admin/index.ts` says so, and says
  //    it retires when they do — and after this it has no renderer at all; the
  //    sidebar row resolves `nav.deliveryMethods.label` in `delivery_methods`'
  //    own namespace. None of the three is spelled here on purpose:
  //    `batch-eight-surfaces.module-owned-surface.test.tsx` asserts a retired
  //    key's **absence from this file's source**, so naming one in a comment
  //    about retiring it reds the assertion that proves it was retired.
  // The two `/organizations*` trails stood here until feature 091's Phase 4
  // batch 14, and the three `/customers*` screens never had one at all — they
  // fell to the humanised-segment fallback. `registryCrumbs` derives all five
  // now, from the sidebar entries the two modules declare. Two operator-visible
  // changes, stated rather than glossed: the *Customers* crumb loses its link,
  // that section holding no host-declared entry any more for `registryCrumbs`
  // to point at (batch 13's *Inventory* and *Pricing*, arriving again), and
  // `/organizations/:id` loses its *Detail* leaf — the shape every converted
  // module's sub-screen already gets. The three `/customers*` screens gain the
  // labels their sidebar rows already carry, where they had none.
  // Five hand-written `/orders*` trails stood here until feature 091's Phase 4
  // batch 15 — the roster, `/orders/new`, `/orders/quick-order`,
  // `/orders/statuses` and the generic `/orders/:id`. `registryCrumbs` derives
  // them from the three sidebar entries `orders` declares, and it gets the
  // ordering property those five had by construction: it takes the **longest**
  // matching entry, where this table took the first, which is why the three
  // named sub-pages had to precede the generic rule here. Three
  // operator-visible changes, stated rather than glossed:
  //
  //  - *Orders* becomes *Sales*, unlinked, on every one of these trails: the
  //    derived trail names the section the module declares, and the section
  //    holds no host entry left to link to.
  //  - `/orders/:id` loses its *Detail* leaf and reads *Sales → Orders*, which
  //    is the shape every converted module's sub-screen already gets. The
  //    `appShell.crumb.detail` key nothing else rendered retires with it.
  //  - `/orders/quick-order` loses its *Quick order* leaf for the same reason
  //    and reads *Sales → Orders* too. `quick_order` declares a route and no
  //    sidebar entry (batch 13), so there is no contributed row to derive a
  //    leaf from; `appShell.nav.quickOrder` retires with the rule.
  // The four `/invoices*` and `/quote-requests*` trails stood here until
  // feature 091's Phase 4 batch 12. `registryCrumbs` derives all four now, out
  // of the sidebar entries the two modules declare, and `/ksef` — which never
  // had a trail at all and fell to the humanised-segment fallback — gains the
  // label its sidebar row already carries. One operator-visible change, stated
  // rather than glossed: these four named *Customers* as their section crumb
  // and linked it to `/organizations`, while the sidebar rows they describe sit
  // in *Sales*. The derived trail reads the section the module declares, so the
  // crumb becomes *Sales* linked to `/orders` — the section's first host entry,
  // which is what every hand-written trail in this table uses and what the
  // sidebar has said all along.
  // The two `/sales-channels*` trails stood here until feature 091's Phase 4
  // batch 14. `registryCrumbs` derives both now, out of the sidebar entry
  // `sales_channels` declares, with the same two changes the `/organizations`
  // note above records: the *Channels* crumb loses its link and
  // `/sales-channels/:code` loses its *Detail* leaf.
  //
  // The seven `/cms…` rules stood here until feature 091's Phase 4 batch 16,
  // which is where the note above said they would retire. `registryCrumbs`
  // derives ten of the eleven `/cms…` trails now, out of the four sidebar
  // entries `cms` declares, and the seven `/blog/…` screens — which never had a
  // hand-written trail at all and fell to the humanised-segment fallback — gain
  // the labels their sidebar rows carry. Three operator-visible changes, stated
  // rather than glossed:
  //
  //  * the section crumb becomes **Content**, unlinked. These seven rules named
  //    *Channels* linked to `/sales-channels`, which was already the wrong
  //    section — the sidebar has put these rows under *Content* for as long as
  //    the section has existed — and `registryCrumbs` reads the section the
  //    module declares. It is unlinked for the reason every emptied section's
  //    is: there is no host-declared row left for it to point at;
  //  * the six editor screens lose their `Editor` leaf and render
  //    `Content / CMS Pages →`, which is the trail every converted module's
  //    sub-screen already gets;
  //  * `/cms` — the bare alias, which has no sidebar row and which
  //    `registryCrumbs` therefore does not match — falls to the
  //    humanised-segment fallback and renders a lone *cms*. It is the one trail
  //    of the eleven that is worse than it was. Repairing it would mean either a
  //    host `<Navigate>`, which moves a `cms` deep link into the admin's own
  //    registry and is the direction this feature reverses, or a second sidebar
  //    row for a path no operator is shown. Neither is worth an unadvertised
  //    alias, and `/dictionaries/audit` took the same answer in batch 10.
  // `/dictionary` and the two audit spellings had a hand-written trail here
  // until feature 091's Phase 4 batch 10. `registryCrumbs` derives them now,
  // from `dictionaries`' own nav contribution — two crumbs where the audit
  // trail built three, the third having been a literal *audit* leaf there is
  // nothing to derive. The unadvertised `/dictionaries/audit` spelling keeps
  // resolving as a route and falls to the humanised-segment trail, which is
  // what an unadvertised alias gets.
  // `/admin-users`, `/admin-roles` and `/audit-log` had a hand-written trail
  // here until feature 091's Phase 4 batch four. They are the modules' own
  // declarations now, so `registryCrumbs` derives the trail from the composed
  // sidebar — the label and the section come off the nav contribution, which is
  // what stops this third registry from being a fifth shared file every
  // converted module has to edit. Two consequences, both operator-visible and
  // both stated rather than discovered: the section crumb's href becomes
  // *System*'s first host entry, `/platform/modules`, where these three trails
  // named `/admin-users` by hand; and the leaf label resolves in the owning
  // module's namespace rather than in `core`.
  { test: /^\/platform\/modules\/?$/, build: () => [
    { labelKey: 'appShell.section.system', href: '/admin-users' },
    { labelKey: 'appShell.nav.platformModules', href: null },
  ] },
  // `/settings` and `/settings/groups` had a hand-written trail here until
  // feature 091's Phase 4 batch 10, and `/settings/cache` and `/settings/pwa`
  // never had one at all — both fell to the humanised-segment fallback.
  // `registryCrumbs` derives all four now, so the two that had a trail keep it
  // with the section link corrected (*System*'s first host row is
  // `/platform/modules`, where these named `/admin-users` by hand — batch
  // four's recorded change, arriving again) and the two that had none gain the
  // label their sidebar row already carries.
  { test: /^\/profile\/?$/, build: () => [
    { labelKey: 'appShell.crumb.myProfile', href: null },
  ] },
  // The six `/transactional-emails*` trails stood here until feature 091's
  // Phase 4 batch 11. `registryCrumbs` derives all six now, out of the sidebar
  // entries `transactional_emails` declares — which is what keeps a converted
  // module's breadcrumb from being a third shared file to edit. Two of them
  // change: the fragment editors lose their `Editor` leaf and render
  // `Messaging / Email Blocks →` instead, which is the trail every other
  // converted module's sub-screen already gets, and the *Messaging* crumb loses
  // its link because that section now holds no host-declared entry for
  // `registryCrumbs` to point at.
];

/**
 * The trail for a screen a **module** contributes, derived from the composed
 * sidebar (feature 091).
 *
 * `CRUMB_DICT` is a third host registry naming module routes by hand — this
 * feature converts `App.tsx`'s and `AppShell.tsx`'s, and the plan does not
 * cover this one. Deriving the leaf instead of adding an entry per module is
 * what keeps a converted module's breadcrumb from being a fifth shared file to
 * edit: the label and the section are already declared in the module's nav
 * contribution, and the parent link is the section's own first host entry —
 * exactly what every hand-written trail in this table uses.
 *
 * Returns `null` for a path no module claims, so `CRUMB_DICT` keeps precedence
 * and the URL-segment fallback keeps the last word.
 */
function registryCrumbs(pathname: string, composedNav: readonly NavSection[]): Crumb[] | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  let best: { section: NavSection; item: NavItem; labelScope: string } | null = null;
  for (const section of composedNav) {
    for (const item of section.items) {
      const labelScope = item.labelScope;
      if (labelScope === undefined) continue;
      // The entry's own destination, or anything beneath it. A module's second
      // and third routes (`/x/new`, `/x/:id`) have no sidebar row of their own
      // and never will — a nav entry is a landing surface — so matching only
      // the exact `to` would drop every converted module's sub-screens onto the
      // humanised-segment fallback below. The hand-written trails this table is
      // draining already covered subpaths that way, with the same shape.
      if (item.to !== path && !path.startsWith(`${item.to}/`)) continue;
      // **The longest match wins, and it is first-match no longer** (feature
      // 091, batch 10). Until this batch no module contributed both a parent
      // route and a child of it, so "the first entry that matches" and "the
      // entry that matches most" were the same answer. `settings` contributes
      // `/settings`, `/settings/groups` and `/settings/cache` and `pwa`
      // contributes `/settings/pwa`; under first-match, all four screens would
      // have rendered *Settings* as their leaf, because `/settings` sorts
      // ahead of the rest by weight. That is a trail that no longer names where
      // the operator is, which is the whole of what a breadcrumb does.
      //
      // `CRUMB_DICT` gets the same property for free by listing its specific
      // patterns above its general ones; this is that ordering rule, derived
      // instead of maintained.
      if (best !== null && best.item.to.length >= item.to.length) continue;
      best = { section, item, labelScope };
    }
  }
  if (best === null) return null;
  const { section, item, labelScope } = best;
  const parent = section.items.find((other) => other.labelScope === undefined);
  const trail: Crumb[] = [];
  if (section.labelKey) {
    trail.push({ labelKey: section.labelKey, href: parent?.to ?? null });
  }
  trail.push({
    labelKey: item.labelKey,
    labelScope,
    href: item.to === path ? null : item.to,
  });
  return trail;
}

function buildCrumbs(pathname: string, composedNav: readonly NavSection[]): Crumb[] {
  for (const entry of CRUMB_DICT) {
    const match = pathname.match(entry.test);
    if (match) return entry.build(match);
  }
  const contributed = registryCrumbs(pathname, composedNav);
  if (contributed !== null) return contributed;
  // Keep real path segments in hrefs; only humanize the visible label.
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((segment, idx) => ({
    literal: segment.replace(/-/g, ' '),
    href: idx === segments.length - 1 ? null : `/${segments.slice(0, idx + 1).join('/')}`,
  }));
}

interface PaletteItem extends GatedSurface {
  /**
   * `Records` and `SeeAll` are global search's (`specs/150-admin-global-search/`):
   * one block per record type the server answered, then one row opening the
   * full results page. They carry server-resolved strings (`labelMode:
   * 'literal'`), and a record block is told apart by `groupKey`.
   */
  group: 'Navigate' | 'Actions' | 'Assistant' | 'Records' | 'SeeAll';
  /** Records only: the entity type, so each record type renders its own header. */
  groupKey?: string;
  /** Records only: the record type's title, already in the admin's language. */
  groupLabel?: string;
  /** Records only: whether the record type has more matches than shown (FR-004). */
  groupHasMore?: boolean;
  /** Records only: the record's status, already in the admin's language. */
  badge?: string;
  /**
   * For static Navigate items: a translation key under the `core` scope.
   * For registry-driven Actions items (feature 020): an already-resolved
   * string the registry produced via the module's labelKey.
   */
  label: string;
  /** Translation key (Navigate) or resolved string (Actions). */
  sub: string;
  /**
   * `'key'` when `label`/`sub` are translation keys (Navigate group);
   * `'literal'` when they are already-resolved strings (Actions group).
   */
  labelMode: 'key' | 'literal';
  icon: LucideIcon;
  to: string;
  keywords: string;
  /**
   * The module that owns the destination, or `null` for a shell surface.
   *
   * Feature 073 / FR-032 closed the module-state half of the palette leak: the
   * server-fed Actions group has filtered on `module_registrations.state` since
   * feature 020, while this array was merged in unfiltered — `/inventory`,
   * `/comparisons`, `/newsletter/*`, `/webhooks`, `/credentials` and
   * `/promotions` among them. A palette entry for an absent module is a link to
   * a 503.
   */
  module?: string | null;
  /**
   * The permission the destination's route enforces. Issue #230 — the other
   * half of the same leak, and the half that survives after module state has
   * done its job: an operator whose modules are all present still saw palette
   * entries for screens their role cannot open, which Principle XVI item 2
   * forbids in as many words. `PaletteItem` had no such field at all, so no
   * amount of data could have gated these rows.
   *
   * Unset means the destination genuinely has no gate (the dashboard) or, for
   * a registry-driven Actions row, that the server already filtered it —
   * `AdminActionsService` resolves both axes before the row reaches us.
   */
  requiredPermission?: PermissionRequirement;
}

/**
 * The palette's one matching rule, for every group it renders.
 *
 * Issue #233. The dialog merges three indexes and used to match with two
 * different rules: the server-fed Actions group filters through `normalize`
 * (`lib/text-normalization.ts`, applied in `lib/admin-actions/useAdminActions.ts`),
 * which folds diacritics *and* the stroked letters NFD leaves standing, while
 * the static Navigate group and the pinned Assistant row used a bare
 * `toLowerCase().includes()`. Typing `zamowienia` therefore found the Actions
 * row for orders and not the Navigate row for the same screen — and Polish
 * operators routinely type without diacritics, so half the palette silently
 * stopped answering them. Issue #236 then found a fourth copy in the
 * page-builder drawer, which is why the fold now lives at
 * `lib/text-normalization.ts` and not under `lib/admin-actions/`.
 *
 * `normalize` is **imported, not re-implemented**: the whole defect was one
 * question answered twice, and a copy is how the two answers drifted apart. It
 * folds `ł` through an explicit stroked-letter map, which matters — `ł` has no
 * NFD decomposition, so the obvious `normalize('NFD').replace(...)` one-liner
 * leaves `płatności` unmatched by `platnosci`.
 *
 * **Both sides are folded.** Folding only the haystack breaks the operator who
 * does type `zamówienia`; folding only the query breaks the one who does not.
 * (Postel's Law — accept what was typed and normalise it.)
 *
 * **Per word, across the row** — every word of the query must occur in some
 * field, not the whole query in one. The rule itself is `lib/palette-match.ts`,
 * shared with the Actions group for the same reason as the fold: a multi-word
 * query such as `kanał sprzedaży` used to need one field carrying those words
 * contiguously, so it missed `Kanały sprzedaży`.
 *
 * `terms` must already be folded by `searchTerms`; the caller does that once
 * per keystroke rather than once per row. `normalize` trims, so a query with a
 * leading space matches what the operator meant rather than nothing at all
 * (issue #236).
 */
function matchesQuery(terms: readonly string[], ...haystacks: string[]): boolean {
  return matchesSearchTerms(terms, haystacks);
}

/**
 * The static Navigate group.
 *
 * **Every `requiredPermission` here is read from the backend route that gates
 * the destination, not from the sidebar entry beside it.** Copying a neighbour
 * is how a wrong code gets propagated twice, and several of these are not what
 * the neighbourhood suggests:
 *
 *  - `/inventory`, `/warehouses`, `/inventory/low-stock` and
 *    `/inventory/notifications` by `inventory:read`, and `/inventory/import` by
 *    `inventory:write` — the module's own codes since 2026-08-29. Until then
 *    all four reads said `orders:read` and the importer said `catalog:write`,
 *    which is how a merchandiser came to be able to delete a warehouse and
 *    anyone who could read orders came to be able to enumerate every warehouse
 *    address (`packages/modules/inventory/src/backend/routes.admin.ts`);
 *  - `/payment-methods` by `payment_methods:read` and `/delivery-methods` by
 *    `delivery_methods:read`, each its owner's own code since 2026-08-28. They
 *    look like a pair and are not one: the codes are separate, they are granted
 *    separately, and neither is `catalog:read`, which is what both said until
 *    the two modules stopped borrowing the catalogue's authority
 *    (`packages/modules/payment_methods/src/backend/routes.ts:125`,
 *    `packages/modules/delivery_methods/src/backend/routes.ts:106`);
 *  - `/api-keys` and `/webhooks` by one shared `integrations:manage`
 *    (`api_keys/routes.ts:20`, `webhooks/routes.ts:21`);
 *  - `/dictionary` and its audit view by `dictionary.write` — the module
 *    declares no read code, so reading the dictionary requires the write one
 *    (`dictionaries/routes.admin.ts:72`);
 *  - `/organizations` by `requireAdminAny(['customers:read',
 *    'customers:manage'])`, which is why the field takes an any-of array.
 *
 * **Denied entries are hidden, not shown disabled** — the same treatment module
 * absence already gets, and applied identically in the sidebar and in the
 * dashboard's quick actions. Three reasons, in order of weight:
 *
 *  1. The Actions group in this very dialog already hides on permission;
 *     `AdminActionsService` filters server-side before the row is sent. Showing
 *     Navigate rows disabled would make one palette use two opposite treatments
 *     for two groups the operator does not distinguish — identical-looking rows
 *     that behave differently (Law of Similarity).
 *  2. On an empty query the palette lists every Navigate entry. For a
 *     single-domain role that is a wall of unusable rows in the surface whose
 *     entire job is to shorten the path to the one thing you asked for (Hick).
 *  3. Keyboard and pointer must reach the same conclusion. The Arrow/Enter loop
 *     below indexes `items` directly, so a disabled row would still be
 *     selectable by keyboard and `Enter` would navigate into a 403 — a
 *     disabled-row design would need `aria-disabled`, a linked reason and cursor
 *     skipping to be honest. Hiding makes the two paths identical by
 *     construction and leaves nothing for a screen reader to announce.
 *
 * The cost of hiding is real and is answered elsewhere: "you do not have access
 * to this" is actionable in a way "this module is not installed" is not, so it
 * belongs at the point of failure — the 403 an operator reaches by bookmark or
 * deep link — rather than in an index the operator is scanning for something
 * else. That screen is not part of this change; see the report.
 */
const PALETTE_ITEMS: PaletteItem[] = [
  { group: 'Navigate', labelMode: 'key', label: 'appShell.nav.home', sub: 'appShell.palette.sub.dashboard', icon: HomeIcon, to: '/', keywords: 'home dashboard strona główna pulpit' , module: null },
  // The `/catalog/products`, `/catalog/categories` and `/catalog/attributes`
  // rows left here in feature 091's Phase 4 batch 15, and they left by batch
  // 10's route: `catalog` declared `new-product` and nothing that *opened* any
  // of the three, so `open-products`, `open-categories` and `open-attributes`
  // arrive with these rows' destinations, codes and keywords, and their labels
  // and descriptions are the six strings the rows rendered, moved into that
  // module's own bundle. The `/orders` row left in the same batch and was
  // batch 12's case instead: `orders`' manifest already declared `open-orders`
  // with the same destination and the same code, so the row was a second copy
  // the server was never asked about and nothing replaces it.
  // The `/inventory` and `/price-lists` rows left here in feature 091's Phase 4
  // batch 13, and they left by the two routes batches 10 and 12 already
  // established. `inventory` was batch 12's case: its manifest already declared
  // `open-inventory` with the same destination and the same code, so the row
  // was a second copy the server was never asked about and nothing replaces it.
  // `price_lists` was batch 10's: it declared no action at all, so
  // `open-price-lists` arrives with this row's destination, code and keywords,
  // and its label and description are the two strings the row rendered, moved
  // into that module's own bundle. Either way the advertisement is now the one
  // surface the effective enabled-set filters.
  // The `/organizations` row left here in feature 091's Phase 4 batch 14, and
  // it left by batch 10's route: `organizations` declared no action at all, so
  // `open-organizations` arrives with this row's destination and keywords, and
  // its label and description are the two strings the row rendered, moved into
  // that module's own bundle.
  //
  // **One operator-visible narrowing, recorded rather than glossed.** This row
  // carried an any-of pair — `['customers:read', 'customers:manage']` — and
  // `ModuleActionSchema.requiredPermission` is a single string
  // (`packages/contracts/src/admin-actions.ts:205`), so the action names
  // `customers:read`. A role holding only `customers:manage` therefore loses
  // this palette entry and keeps the sidebar one, whose declaration takes the
  // whole `PermissionRequirement` and keeps the pair. The screen stays
  // reachable; only the second way of reaching it narrows. Widening the action
  // schema would touch the palette resolver, the permission inventory and
  // `check:action-route-permissions`, which is a change of its own and not a
  // batch's.
  // The `/quote-requests` row left here in feature 091's Phase 4 batch 12, and
  // nothing replaced it: `quote_requests`' manifest already declares
  // `open-rfq-inbox` with the same destination, the same code and the same
  // keywords, so the row was a second copy of a declaration the server has been
  // serving all along — and a copy the server was never asked about, which for
  // a module an operator can withdraw means a palette that goes on advertising
  // the screen after the withdrawal.
  // The `/sales-channels` row left here in the same batch and by the same
  // route. `sales_channels` declared `new-sales-channel` and nothing that
  // *opened* the roster, so `open-sales-channels` arrives with this row's
  // destination, code and keywords, and its label and description are the two
  // strings the row rendered.
  // The four `dictionaries`, `settings` and `credentials` rows left here in
  // feature 091's Phase 4 batch 10. A hand-written palette row is a copy the
  // server was never asked about — it went on advertising the screen after an
  // operator withdrew the module — so each is a manifest **action** now, which
  // is the surface the effective enabled-set filters. `settings` and
  // `credentials` already declared theirs (`open-settings`, `open-credentials`,
  // `new-credential`); `dictionaries` declares `open-dictionary` and
  // `open-dictionary-audit` for the first time, with the destinations, codes
  // and keywords these rows carried.
  // Feature 020 — the Actions group is now sourced from the module
  // registry via useAdminActions(); the previously-hardcoded "New
  // product" and "Import products" entries are declared by the
  // catalog and import_export module manifests respectively.
];


/**
 * `[...hostNav, ...registryNav]`, per section (feature 091, FR-010;
 * `contracts/admin-registry.md` R11).
 *
 * Built once at module scope because the registry is a static import: a
 * contribution set cannot change without a rebuild, and recomputing it per
 * render would allocate a new array on every keystroke in the palette input.
 *
 * **A module's entries append to their section**, ordered among themselves by
 * `weight` then module id. R11 describes the end state — the whole section
 * weight-ordered — which needs a weight on all 97 host entries and is Story 3's
 * to deliver as it drains them; inventing one per host entry now would be a
 * hundred numbers nothing derives. The consequence is visible and worth
 * stating: `/import-export` used to sit between Credentials and Settings in the
 * System group and now sits at that group's end.
 *
 * **A module may not invent a section** (D-23): `AdminNavSectionNameSchema` is
 * closed, and a contribution naming a section this shell does not declare
 * renders nowhere — so the composition refuses it here rather than dropping it
 * silently.
 */
function composeNav(
  sections: readonly NavSection[],
  entries: readonly AdminRegistryEntry[],
): NavSection[] {
  const declared = new Set(sections.map((section) => section.key));
  for (const entry of entries) {
    for (const item of entry.contributions.nav ?? []) {
      if (declared.has(item.section)) continue;
      throw new Error(
        `Module '${entry.moduleId}' contributes a sidebar entry in section '${item.section}', ` +
          `which this shell does not declare. An entry in a section nobody renders is a ` +
          `surface that silently appears nowhere.`,
      );
    }
  }
  return sections.map((section) => ({
    ...section,
    items: [
      ...section.items,
      ...registryNavFor(section.key, entries).map(
        (item): NavItem => ({
          to: item.to,
          labelKey: item.labelKey,
          labelScope: item.module,
          icon: resolveIcon(item.icon),
          // `exactOptionalPropertyTypes` — an ungated entry has no property,
          // not a property holding `undefined`.
          ...(item.requiredPermission === undefined
            ? {}
            : { requiredPermission: item.requiredPermission }),
          module: item.module,
        }),
      ),
    ],
  }));
}

/**
 * The host's sections with every module's contributed entry folded in.
 *
 * A hook rather than a module constant (feature 110, T120), because the
 * registry is now the admin project's value and arrives through
 * `AdminRegistryProvider`: a constant evaluated at import time would have to
 * read a file this package may not name. `useMemo` keys on the registry
 * identity, which is a module-scope array in every real build, so the
 * composition runs once per mount exactly as the constant did once per process
 * — and `composeNav`'s refusal of an undeclared section now raises during
 * render instead of during import, where a test can see which section it was.
 */
function useComposedNav(): NavSection[] {
  const entries = useAdminRegistry();
  return useMemo(() => composeNav(NAV, entries), [entries]);
}

/**
 * `t` for a nav entry's label, in whichever scope the entry declares.
 *
 * The host's entries resolve in `core` and a module's in its own namespace, and
 * both go through the one translation context — a second resolver would be the
 * drift issue #230 removed from the visibility question, in the label.
 */
function useNavLabel(): (item: NavItem) => string {
  const { t } = useTranslationContext();
  return useCallback(
    (item: NavItem): string => t(item.labelScope ?? 'core', item.labelKey),
    [t],
  );
}

/** The sentence the pin and unpin live regions say, in the admin's language (FR-005). */
function pinAnnouncementText(
  t: (key: string, params?: Record<string, string | number>) => string,
  outcome: PinOutcome,
  label: string,
): string {
  return t(
    outcome === 'pinned' ? 'appShell.pinned.announce.pinned' : 'appShell.pinned.announce.unpinned',
    { label },
  );
}

export function AppShell(): ReactNode {
  const { me, logout } = useAuth();
  // The host's nav with every installed module's contributed entry folded in.
  const composedNav = useComposedNav();
  // Feature 073 — the effective enabled-set. A module that is off contributes
  // no sidebar entry and no palette entry; neither surface recombines the two
  // presence axes, because the server already did.
  const { isPresent: isModulePresent } = useModulePresence();
  const isVisible = useSurfaceVisibility();
  const navigate = useNavigate();
  const location = useLocation();
  // Feature 164 — folded groups and rail mode are the admin's, kept on the
  // server and present in the first render (FR-013, FR-016). A stored group key
  // this release does not render folds nothing and is kept in the next write
  // (FR-015).
  const [collapsedGroups, setCollapsedGroups] = useAdminPreference('sidebarCollapsedGroups');
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);
  const [storedRailMode, setStoredRailMode] = useAdminPreference('sidebarRailMode');
  const platformVersion = usePlatformVersion();
  const feedbackOffered = isModulePresent('admin_feedback');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const viewportTier = useViewportTier();
  const isMobile = viewportTier === 'mobile';
  useFocusTrap(sidebarRef, isMobile && navDrawerOpen);
  // Rail mode has no effect on the mobile tier, whatever is stored (FR-013).
  const railMode = storedRailMode && !isMobile;

  const toggleRailMode = useCallback((): void => {
    setStoredRailMode(!storedRailMode);
  }, [storedRailMode, setStoredRailMode]);
  const t = useTranslation('core');
  // The brand link's tooltip. With a release known it is the full sentence in
  // either mode: collapsed, the badge has no room and this is the only place
  // the number is; expanded, the badge takes no pointer events (the whole
  // header is one click target) and this is what spells out an identifier the
  // badge had to truncate. A sentence that does not carry the number is an
  // unresolved key, and the tooltip then stays what it was before the badge.
  const brandTooltip = useMemo((): string | undefined => {
    const fallback = railMode ? t('appShell.brand.text') : undefined;
    if (platformVersion === null) return fallback;
    const sentence = t('appShell.brand.versionLabel', { version: platformVersion });
    return sentence.includes(platformVersion) ? sentence : fallback;
  }, [t, platformVersion, railMode]);
  const navLabel = useNavLabel();
  // The raw, scope-taking resolver, for the breadcrumb: a crumb a module
  // contributed resolves its label in that module's own namespace.
  const { t: tScoped } = useTranslationContext();

  // Feature 164 — the sidebar's visible destinations, built once with the same
  // predicate the sections render with and read by both the Pinned section and
  // the palette's pin control (research R-7, R-15): a pin is the original
  // entry's own object, so it cannot show a surface its original would not.
  const pinTargets = useMemo(
    () => visibleDestinations(composedNav, isVisible),
    [composedNav, isVisible],
  );
  const { pins, isPinned, toggle: togglePin, setPins } = usePinActions();
  const resolvedPins = useMemo(() => resolvePinsFrom(pins, pinTargets), [pins, pinTargets]);
  // One polite region for every pin and unpin in the sidebar (FR-005), mounted
  // empty and outside the sidebar, which the closed drawer hides from AT.
  const [pinAnnouncement, setPinAnnouncement] = useState('');
  const togglePinOf = useCallback(
    (item: NavItem): void => {
      const outcome = togglePin(item.to);
      setPinAnnouncement(pinAnnouncementText(t, outcome, navLabel(item)));
    },
    [togglePin, t, navLabel],
  );

  const fullName = me ? `${me.adminUser.firstName} ${me.adminUser.lastName}`.trim() : '';
  const role = me?.role?.name ?? 'Admin';

  const toggleSection = useCallback(
    (key: string): void => {
      setCollapsedGroups(
        collapsedGroups.includes(key)
          ? collapsedGroups.filter((group) => group !== key)
          : [...collapsedGroups, key],
      );
    },
    [collapsedGroups, setCollapsedGroups],
  );

  // ⌘K opens the palette anywhere in the admin; ⌘B toggles the
  // sidebar rail (matches the shadcn / VS Code shortcut convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // `!e.shiftKey` keeps ⌘K off Ctrl/⌘+Shift+K, which pages claim for
      // their own in-page search (e.g. the Settings page's filter box).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (
        !isMobile &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'b'
      ) {
        e.preventDefault();
        toggleRailMode();
      } else if (e.key === 'Escape' && navDrawerOpen) {
        setNavDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [toggleRailMode, isMobile, navDrawerOpen]);

  useEffect(() => {
    setNavDrawerOpen(false);
  }, [location.pathname]);

  const crumbs = useMemo(
    () => buildCrumbs(location.pathname, composedNav),
    [location.pathname, composedNav],
  );
  const isCmsRoute = location.pathname.startsWith('/cms');

  return (
    <div
      className={cn(
        'b2b-app-layout',
        isMobile ? null : railMode ? 'b2b-app-layout--rail' : 'b2b-app-layout--expanded',
      )}
    >
      {isMobile && navDrawerOpen ? (
        <button
          type="button"
          className="b2b-nav-drawer-backdrop"
          aria-label={t('appShell.mobileMenu.close')}
          onClick={(): void => setNavDrawerOpen(false)}
        />
      ) : null}
      {/* ============ Sidebar ============ */}
      <aside
        ref={sidebarRef}
        className={cn(
          'b2b-sidebar',
          railMode && 'b2b-sidebar--rail',
          isMobile && navDrawerOpen && 'b2b-sidebar--drawer-open',
        )}
        aria-hidden={isMobile && !navDrawerOpen ? true : undefined}
        role="navigation"
        aria-label={t('appShell.mobileMenu.title')}
      >
        <NavLink
          to="/"
          end
          className="b2b-sidebar__brand"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          aria-label={t('appShell.brand.dashboardLink')}
          title={brandTooltip}
        >
          <span className="b2b-sidebar__brand-logo">
            <BrandLogo label={t('appShell.brand.text')} />
          </span>
          <span className="b2b-sidebar__brand-text">
            {t('appShell.brand.textPrimary')}{' '}
            <span className="b2b-sidebar__brand-text-accent">
              {t('appShell.brand.textAccent')}
            </span>
          </span>
        </NavLink>
        {/* The release has a section of its own between the logo and the
            search, divided from both. It is the link's sibling, not its child:
            the link's `aria-label` replaces its content as the accessible
            name, so a version inside it would be announced by nothing. */}
        {/* *Send feedback* (#379) sits beside the release, and is there while
            the module that owns its endpoint is. Collapsed, the release is
            hidden and the link is an icon of its own. */}
        {platformVersion !== null || feedbackOffered ? (
          <div className="b2b-sidebar__version">
            {platformVersion !== null ? <VersionBadge version={platformVersion} /> : null}
            {feedbackOffered && !railMode ? <AdminFeedback rail={false} /> : null}
          </div>
        ) : null}
        {feedbackOffered && railMode ? (
          <div className="b2b-sidebar__feedback-rail-row">
            <AdminFeedback rail />
          </div>
        ) : null}

        <div className="b2b-sidebar__search">
          {railMode ? (
            <button
              type="button"
              className="b2b-sidebar__search-rail"
              onClick={(): void => setPaletteOpen(true)}
              title={t('appShell.search.openPalette')}
              aria-label={t('appShell.search.openPalette')}
            >
              <Search size={16} />
            </button>
          ) : (
            <>
              <Search size={14} className="b2b-sidebar__search-icon" />
              <input
                className="b2b-sidebar__search-input"
                placeholder={t('appShell.search.placeholder')}
                readOnly
                onClick={(): void => setPaletteOpen(true)}
                onFocus={(): void => setPaletteOpen(true)}
              />
              <span className="b2b-sidebar__search-kbd">{t('appShell.search.shortcutSymbol')}</span>
            </>
          )}
        </div>

        <nav className="b2b-sidebar__nav">
          {railMode ? (
            resolvedPins.length > 0 ? (
              <RailSection
                key="pinned"
                section={{
                  key: 'pinned',
                  labelKey: 'appShell.pinned.heading',
                  items: resolvedPins.map((pin) => pin.item),
                }}
                visibleItems={resolvedPins.map((pin) => pin.item)}
                translatedLabel={t('appShell.pinned.heading')}
                pinned={{
                  icon: Pin,
                  endOf: (item): boolean =>
                    resolvedPins.find((pin) => pin.item === item)?.end ?? false,
                  onUnpin: togglePinOf,
                }}
              />
            ) : null
          ) : (
            <PinnedSection
              pins={resolvedPins}
              sections={composedNav}
              collapsed={collapsed.has('pinned')}
              onToggleCollapsed={toggleSection}
              onUnpin={(pin): void => togglePinOf(pin.item)}
              onReorder={(visibleOrder): void => setPins(reorderVisiblePins(pins, visibleOrder))}
              navLabel={navLabel}
              touch={isMobile}
            />
          )}
          {composedNav.map((section) => {
            const isOpen = !collapsed.has(section.key);
            // Permission-gate every entry, then presence-gate it (feature 073 /
            // FR-031). Sections with no remaining visible items fold away
            // entirely, which is what makes a whole domain disappear when every
            // module in it is off — the same behaviour restricted admins have
            // always had.
            //
            // Issue #230 — the predicate is `isSurfaceVisible`, shared with the
            // command palette and the dashboard quick actions. The palette used
            // to run a second, weaker copy of it; a shared helper is what stops
            // the three from disagreeing again.
            const visibleItems = section.items.filter(isVisible);
            if (visibleItems.length === 0) return null;
            // Feature 019 / 021 — section labels go through useTranslation('core').
            // The empty-labelKey "main" cluster keeps no label; every other
            // group resolves its declared `labelKey`. Polish strings live
            // in packages/modules/_i18n/i18n/pl.json under the same key.
            const translatedLabel = section.labelKey ? t(section.labelKey) : '';
            // In rail mode the section reduces to one icon (the first
            // visible item's icon). Hover or click reveals a popover
            // listing every visible item in the section.
            if (railMode) {
              return (
                <RailSection
                  key={section.key}
                  section={section}
                  visibleItems={visibleItems}
                  translatedLabel={translatedLabel}
                />
              );
            }
            return (
              <div
                key={section.key}
                className={cn(
                  'b2b-sidebar__group',
                  !isOpen && section.labelKey && 'b2b-sidebar__group--collapsed',
                )}
              >
                {section.labelKey ? (
                  <button
                    type="button"
                    className="b2b-sidebar__group-label"
                    onClick={(): void => toggleSection(section.key)}
                  >
                    <ChevronDown size={11} />
                    <span>{translatedLabel}</span>
                  </button>
                ) : null}
                <div className="b2b-sidebar__items">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    // Force exact-match (`end`) when another item in the same
                    // section nests under this item's path. Without this, a
                    // parent route like `/inventory` lights up alongside its
                    // children (`/inventory/low-stock`, `/inventory/import`,
                    // …) because NavLink's default match is prefix-based.
                    // The home link (`/`) is the canonical example and is
                    // covered by the same rule (every other item starts with
                    // `/`).
                    const hasNestedSibling = section.items.some(
                      (other) =>
                        other !== item &&
                        other.to.startsWith(item.to === '/' ? '/' : `${item.to}/`),
                    );
                    const label = navLabel(item);
                    // Feature 164 — the pin control is the row's second Tab
                    // stop, after the link and never inside it (FR-004).
                    return (
                      <div key={item.to} className="b2b-nav-row">
                        <NavLink
                          to={item.to}
                          end={item.to === '/' || hasNestedSibling}
                          className={({ isActive }): string =>
                            cn('b2b-nav-item', isActive && 'is-active')
                          }
                        >
                          <Icon size={16} />
                          <span style={{ flex: 1 }}>{label}</span>
                        </NavLink>
                        <PinToggleButton
                          label={label}
                          pinned={isPinned(item.to)}
                          touch={isMobile}
                          onToggle={(): void => togglePinOf(item)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {me ? (
          <div className="b2b-sidebar__foot">
            <NavLink
              to="/profile"
              className="b2b-sidebar__foot-identity"
              title={
                railMode
                  ? `${fullName || me.adminUser.email} — ${t('appShell.profileMenu.profile')}`
                  : t('appShell.profileMenu.profile')
              }
              aria-label={t('appShell.profileMenu.profile')}
            >
              <div className="b2b-avatar">
                {(fullName || me.adminUser.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="meta">
                <div className="name">{fullName || me.adminUser.email}</div>
                <div className="role">{role}</div>
              </div>
            </NavLink>
            <button
              type="button"
              className="icon-btn"
              title={t('appShell.profileMenu.signOut')}
              aria-label={t('appShell.profileMenu.signOut')}
              onClick={(): void => void logout()}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
        {!isMobile ? (
        <button
          type="button"
          className="b2b-sidebar__rail-toggle"
          onClick={toggleRailMode}
          title={
            railMode
              ? (t('appShell.sidebarToggle.expand') || 'Expand sidebar (⌘B)')
              : (t('appShell.sidebarToggle.collapse') || 'Collapse sidebar (⌘B)')
          }
          aria-label={
            railMode
              ? (t('appShell.sidebarToggle.expand') || 'Expand sidebar')
              : (t('appShell.sidebarToggle.collapse') || 'Collapse sidebar')
          }
          aria-pressed={railMode}
        >
          {railMode ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {!railMode ? (
            <span className="b2b-sidebar__rail-toggle-label">
              {t('appShell.sidebarToggle.collapse') || 'Collapse'}
            </span>
          ) : null}
        </button>
        ) : null}
      </aside>

      <div role="status" aria-live="polite" className="sr-only" data-testid="sidebar-pin-status">
        {pinAnnouncement}
      </div>

      {/* ============ Main column (topbar + content) ============ */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="b2b-topbar">
          {isMobile ? (
            <button
              type="button"
              className="b2b-topbar__menu-btn"
              aria-label={t('appShell.mobileMenu.open')}
              aria-expanded={navDrawerOpen}
              onClick={(): void => setNavDrawerOpen((open) => !open)}
            >
              <Menu size={20} />
            </button>
          ) : null}
          <div className={isCmsRoute ? 'b2b-topbar__crumbs-inner b2b-page b2b-page--wide' : 'b2b-topbar__crumbs'}>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 ? <ChevronRight size={12} className="crumb-sep" /> : null}
                {c.href ? (
                  <NavLink
                    to={c.href}
                    className="crumb-link"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {c.labelKey !== undefined ? tScoped(c.labelScope ?? 'core', c.labelKey) : c.literal}
                  </NavLink>
                ) : (
                  <span className="crumb-cur">
                    {c.labelKey !== undefined ? tScoped(c.labelScope ?? 'core', c.labelKey) : c.literal}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="b2b-topbar__actions">
            <button
              type="button"
              className="b2b-topbar__icon-btn"
              title={t('appShell.search.openPalette')}
              aria-label={t('appShell.search.openPalette')}
              onClick={(): void => setPaletteOpen(true)}
            >
              <Search size={16} />
            </button>
            {/*
              Issue #112 — the bell renders only while the owning module is
              present, so a deactivated `admin_notifications` contributes no
              widget polling a 503. Issue #518 — and for every signed-in admin:
              the feed answers each admin their own notifications with no
              permission code, and `admin:read` decides only whether the
              `all_admins` broadcasts are among them.
            */}
            {isModulePresent('admin_notifications') ? (
              <NotificationBell />
            ) : null}
            <button
              type="button"
              className="b2b-topbar__icon-btn b2b-topbar__hide-mobile"
              title={t('appShell.topbar.help')}
              aria-label={t('appShell.topbar.help')}
            >
              <HelpCircle size={16} />
            </button>
            <div style={{ width: 1, height: 22, background: 'var(--border-color)', margin: '0 4px' }} />
            {/*
              Feature 019 / FR-017 — language picker. Same backend round-trip
              as ProfilePage's language section, exposed inline so the user
              can switch the UI language from any screen without navigating.
            */}
            <LanguagePicker />
            {me ? (
              <NavLink
                to="/profile"
                className="b2b-avatar"
                title={`${fullName || me.adminUser.email} — ${t('appShell.profileMenu.profile')}`}
                aria-label={t('appShell.profileMenu.profile')}
                style={{ textDecoration: 'none', cursor: 'pointer' }}
              >
                {(fullName || me.adminUser.email).slice(0, 2).toUpperCase()}
              </NavLink>
            ) : null}
          </div>
        </div>
        <PreferencesSaveNotice />
        <main className="b2b-main" style={{ flex: 1, overflow: 'auto' }}>
          <div className="b2b-impersonation-slot" data-impersonation-banner />
          {/* Issue #140 — a session whose role is null reaches no gated
              surface, so the shell says why instead of showing an empty panel. */}
          {me !== null && me.role === null ? <RoleRequiredNotice /> : null}
          <Outlet />
        </main>
      </div>

      <CommandPalette
        pinTargets={pinTargets}
        open={paletteOpen}
        onClose={(): void => setPaletteOpen(false)}
        onNavigate={(to): void => {
          navigate(to);
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}

/* ============================================================
   RailSection — icon-only sidebar entry with hover/click popover
   ============================================================
   When the sidebar is in rail mode, every NAV section renders as a
   single icon (the first visible item's icon). Hovering or clicking
   the icon reveals a popover with every visible item in the section,
   styled like a mini-version of the regular nav. Sections with one
   item collapse to a plain link with no popover.

   Hover-out has a small grace period so the cursor can travel from
   the icon to the popover without it disappearing. Click toggles the
   popover sticky-open; clicking elsewhere closes it. The active-route
   highlight propagates to the rail icon: if any item in the section
   matches the current URL, the icon shows the is-active style. */
interface RailSectionProps {
  section: NavSection;
  visibleItems: NavItem[];
  translatedLabel: string;
  /**
   * Feature 164 — the Pinned section's rail form (US1 AS-9): its own icon, a
   * popover even for one pin, each row the original's `end` flag and an unpin
   * control. Not a `menu`: a menu may hold only menu items, and the row holds a
   * link and a button.
   */
  pinned?: {
    icon: LucideIcon;
    endOf: (item: NavItem) => boolean;
    onUnpin: (item: NavItem) => void;
  };
}

function RailSection(props: RailSectionProps): ReactNode {
  const { section, visibleItems, translatedLabel, pinned } = props;
  const navLabel = useNavLabel();
  const [hover, setHover] = useState(false);
  const [sticky, setSticky] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const open = hover || sticky;
  const location = useLocation();

  // Active-state for the rail icon: light up when ANY visible item in
  // the section matches the current URL (exact for the home route,
  // prefix-with-segment-boundary for everything else).
  const sectionActive = visibleItems.some((item) => {
    if (item.to === '/') return location.pathname === '/';
    return (
      location.pathname === item.to ||
      location.pathname.startsWith(`${item.to}/`)
    );
  });

  const cancelClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback((): void => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setHover(false), 120);
  }, [cancelClose]);

  // Click outside the wrapper closes the sticky popover.
  useEffect(() => {
    if (!sticky) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSticky(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return (): void => window.removeEventListener('mousedown', onDown);
  }, [sticky]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const railSource = visibleItems[0] ?? section.items[0];
  if (!railSource) return null;
  const RailIcon = pinned?.icon ?? railSource.icon;
  const headerLabel = translatedLabel || (visibleItems[0] ? navLabel(visibleItems[0]) : '');

  // Single-item section: render a plain link with no popover. The
  // hover area is the link itself; tooltip carries the label.
  if (visibleItems.length === 1 && pinned === undefined) {
    const only = visibleItems[0]!;
    const Icon = only.icon;
    const onlyLabel = navLabel(only);
    return (
      <div className="b2b-sidebar__rail-row">
        <NavLink
          to={only.to}
          end={only.to === '/'}
          className={({ isActive }): string =>
            cn('b2b-nav-item b2b-nav-item--rail', isActive && 'is-active')
          }
          title={onlyLabel}
          aria-label={onlyLabel}
        >
          <Icon size={18} />
        </NavLink>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="b2b-sidebar__rail-row"
      onMouseEnter={(): void => {
        cancelClose();
        setHover(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={cn(
          'b2b-nav-item b2b-nav-item--rail',
          sectionActive && 'is-active',
          open && 'is-open',
        )}
        onClick={(): void => setSticky((prev) => !prev)}
        {...(pinned === undefined ? { 'aria-haspopup': 'menu' as const } : {})}
        aria-expanded={open}
        aria-label={headerLabel}
        title={headerLabel}
      >
        <RailIcon size={18} />
      </button>
      {open && pinned !== undefined ? (
        <div className="b2b-sidebar__rail-popover">
          {headerLabel ? (
            <div className="b2b-sidebar__rail-popover-header">{headerLabel}</div>
          ) : null}
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const label = navLabel(item);
            return (
              <div key={item.to} className="b2b-sidebar__rail-popover-row">
                <NavLink
                  to={item.to}
                  end={pinned.endOf(item)}
                  className={({ isActive }): string =>
                    cn('b2b-sidebar__rail-popover-item', isActive && 'is-active')
                  }
                  onClick={(): void => {
                    setSticky(false);
                    setHover(false);
                  }}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </NavLink>
                <PinToggleButton label={label} pinned onToggle={(): void => pinned.onUnpin(item)} />
              </div>
            );
          })}
        </div>
      ) : open ? (
        <div className="b2b-sidebar__rail-popover" role="menu">
          {headerLabel ? (
            <div className="b2b-sidebar__rail-popover-header">{headerLabel}</div>
          ) : null}
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const hasNestedSibling = visibleItems.some(
              (other) =>
                other !== item &&
                other.to.startsWith(item.to === '/' ? '/' : `${item.to}/`),
            );
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || hasNestedSibling}
                role="menuitem"
                className={({ isActive }): string =>
                  cn('b2b-sidebar__rail-popover-item', isActive && 'is-active')
                }
                onClick={(): void => {
                  setSticky(false);
                  setHover(false);
                }}
              >
                <Icon size={14} />
                <span>{navLabel(item)}</span>
              </NavLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
  /**
   * Feature 164, FR-027 — the sidebar's visible destinations (`AppShell`'s one
   * map). A result whose destination is in it, from any group, gets a pin
   * control; nothing else does, so the palette cannot offer a hidden surface.
   */
  pinTargets: ReadonlyMap<string, VisibleDestination>;
}

/** The `Alt+Enter` chord as the platform writes it (FR-027, research R-16). */
const ALT_ENTER_GLYPH =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥↵' : 'Alt+↵';

/** Sentinel route for the assistant entry row — switches the palette mode
 *  instead of navigating (feature 043; module_actions are navigation-only). */
const PROMPT_MODE_SENTINEL = '__prompt_actions_mode__';

/**
 * The last answer the capability probe gave, kept at module level so a palette
 * that mounts again paints the assistant row at once instead of one round trip
 * later. **It is a first paint, not an answer**: every open asks again.
 *
 * It used to be the answer — "one fetch per session" — and that is the defect
 * the owner reported: an operator who had opened the palette once, then
 * enabled the assistant and attached credentials on the Settings screen, was
 * shown the pre-save state until the page was reloaded, while the backend had
 * answered `ready` from the first read after the save. Nothing tells the shell
 * that a setting changed, so the only honest lifetime for this value is one
 * open.
 */
let promptCapabilityCache: 'ready' | 'unavailable' | null = null;

/** Test seam — interaction tests exercise multiple capability states. */
export function resetPromptCapabilityCacheForTesting(): void {
  promptCapabilityCache = null;
}

function CommandPalette(props: CommandPaletteProps): ReactNode {
  const { open, onClose, onNavigate, pinTargets } = props;
  const t = useTranslation('core');
  const navLabel = useNavLabel();
  const { isPinned, toggle: togglePin } = usePinActions();
  // The palette is `aria-modal`, so assistive technology ignores the sidebar's
  // region while it is open: it announces in its own (research R-16).
  const [pinAnnouncement, setPinAnnouncement] = useState('');
  const instructionsId = useId();
  const tp = useTranslation('prompt_actions');
  const { hasPermission } = useAuth();
  const isVisible = useSurfaceVisibility();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<'search' | 'prompt'>('search');
  const [assistantReady, setAssistantReady] = useState(promptCapabilityCache === 'ready');
  const [unseen, setUnseen] = useState<PromptActionRequestDto[]>([]);
  const [initialRequest, setInitialRequest] = useState<PromptActionRequestDto | undefined>(
    undefined,
  );
  // Seed text carried into prompt mode by the `/ai <command>` palette shortcut.
  const [initialPrompt, setInitialPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { actions: registryActions } = useAdminActions(query);
  const { language } = useTranslationContext();
  // Global search (`specs/150-admin-global-search/`): records of every type the
  // admin may read, below the screens and actions. The shell names an endpoint
  // and nothing else — no module id, no module bundle (research R-8).
  const records = useGlobalSearch(open && mode === 'search', query, language);

  // Feature 043 — capability probe, only when the operator may use the
  // assistant. With the feature disabled/unconfigured (or the permission
  // missing) the palette renders exactly as before (FR-015/FR-020, SC-006).
  const mayUseAssistant = hasPermission('prompt_actions:use');
  // Asked on every open, never once per session: the assistant's settings are
  // changed on another screen of this same page, and a remembered answer is
  // the pre-save one. A failed probe withdraws the row as well — it used to
  // leave a `ready` state standing — and is not remembered past this open.
  useEffect(() => {
    if (!open || !mayUseAssistant) return;
    let superseded = false;
    const settle = (answer: 'ready' | 'unavailable'): void => {
      if (superseded) return;
      promptCapabilityCache = answer;
      setAssistantReady(answer === 'ready');
    };
    void getPromptCapability()
      .then((cap) => settle(cap.status === 'ready' ? 'ready' : 'unavailable'))
      .catch(() => settle('unavailable'));
    return (): void => {
      superseded = true;
    };
  }, [open, mayUseAssistant]);

  // FR-018 — completion notice: prompts that finished while the palette was
  // closed surface on the next open until acknowledged.
  useEffect(() => {
    if (!open || !mayUseAssistant || !assistantReady) {
      setUnseen([]);
      return;
    }
    void listUnseenPromptRequests()
      .then(setUnseen)
      .catch(() => setUnseen([]));
  }, [open, mayUseAssistant, assistantReady]);

  // Map registry-supplied actions into the local PaletteItem shape so
  // the rendering loop stays uniform across Navigate (static) and
  // Actions (registry-driven) groups.
  const actionItems = useMemo<PaletteItem[]>(
    () =>
      registryActions.map((a) => ({
        group: 'Actions',
        labelMode: 'literal',
        label: a.label,
        sub: a.description ?? '',
        icon: resolveIcon(a.icon),
        to: a.targetRoute,
        // Carried for shape uniformity only: an Actions row is filtered by
        // `useAdminActions(query)` before it reaches this mapper, so nothing
        // below reads this field. Kept unfolded — `matchesQuery` normalises
        // its haystack at compare time, and a second, differently-normalised
        // copy of the same data is what issue #233 was about.
        keywords: a.keywords.join(' '),
      })),
    [registryActions],
  );

  // Feature 073 / FR-032 plus issue #230 — the Navigate group, filtered on both
  // axes by the same predicate the sidebar uses. The Actions group needs nothing
  // here: the server already resolves both axes for it.
  const navigateItems = useMemo<PaletteItem[]>(
    () => PALETTE_ITEMS.filter(isVisible),
    [isVisible],
  );

  // Build a derived view that translates Navigate-group keys at render
  // time and leaves the registry-supplied Actions strings untouched.
  const resolveLabel = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.label) : it.label;
  const resolveSub = (it: PaletteItem): string =>
    it.labelMode === 'key' ? t(it.sub) : it.sub;

  // Feature 043 — pinned assistant entry (only when enabled + configured +
  // permitted). Always listed first; matched generously while typing.
  const assistantItems = useMemo<PaletteItem[]>(() => {
    if (!mayUseAssistant || !assistantReady) return [];
    return [
      {
        group: 'Assistant',
        labelMode: 'literal',
        label: tp('palette.entry.label'),
        sub: tp('palette.entry.description'),
        icon: Sparkles,
        to: PROMPT_MODE_SENTINEL,
        keywords: 'assistant ai prompt ask asystent zapytaj',
      },
    ];
  }, [mayUseAssistant, assistantReady, tp]);

  // Global search's rows. Only selectable rows enter `items`, so the one
  // Arrow/Enter loop walks screens, actions and records as one list (FR-006);
  // a record type that could not be searched is a note under its header, never
  // a row the cursor stops on.
  const recordItems = useMemo<PaletteItem[]>(() => {
    if (!records.available || records.searchedQuery === '') return [];
    const rows: PaletteItem[] = [];
    for (const group of records.groups) {
      for (const hit of group.hits) {
        rows.push({
          group: 'Records',
          groupKey: group.entityType,
          groupLabel: group.label,
          groupHasMore: group.hasMore,
          labelMode: 'literal',
          label: hit.title,
          sub: hit.subtitle ?? '',
          ...(hit.status ? { badge: hit.status.label } : {}),
          icon: resolveIcon(group.icon),
          to: hit.targetRoute,
          keywords: '',
        });
      }
    }
    return rows;
  }, [records]);

  // "See all results" — whenever record search ran for the text in the input
  // (FR-029); it opens the full results page for the same text.
  const seeAllItem = useMemo<PaletteItem | null>(() => {
    const trimmed = query.trim();
    if (!records.available || trimmed.length < records.minimumQueryLength) return null;
    return {
      group: 'SeeAll',
      labelMode: 'literal',
      label: t('appShell.palette.records.seeAll', { query: trimmed }),
      sub: '',
      icon: Search,
      to: `/global-search?q=${encodeURIComponent(trimmed)}`,
      keywords: '',
    };
  }, [records.available, records.minimumQueryLength, query, t]);

  const itemsBeforeSeeAll = useMemo(() => {
    if (!query.trim()) return [...assistantItems, ...navigateItems, ...actionItems];
    // Folded once here, then compared against every row — see `matchesQuery`.
    const q = searchTerms(query);
    const filteredAssistant = assistantItems.filter((i) =>
      matchesQuery(q, i.label, i.sub, i.keywords),
    );
    // Navigate group: filter against the *translated* label + sub plus
    // the raw keywords list so a Polish user can search in Polish and
    // an English user in English.
    const filteredNav = navigateItems.filter((i) =>
      matchesQuery(q, resolveLabel(i), resolveSub(i), i.keywords),
    );
    return [...filteredAssistant, ...filteredNav, ...actionItems, ...recordItems];
    // `resolveLabel` / `resolveSub` are render-scoped closures over `t`; the
    // list re-derives on every language change through the parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, actionItems, assistantItems, navigateItems, recordItems]);

  const items = useMemo(
    () => (seeAllItem ? [...itemsBeforeSeeAll, seeAllItem] : itemsBeforeSeeAll),
    [itemsBeforeSeeAll, seeAllItem],
  );

  // FR-027 — a row is pinnable when its destination **is** a visible sidebar
  // entry's. The assistant sentinel and "see all" (a path with a query) never
  // match a destination, so they never carry the control.
  const pinTargetOf = useCallback(
    (it: PaletteItem): VisibleDestination | undefined =>
      it.to === PROMPT_MODE_SENTINEL ? undefined : pinTargets.get(it.to),
    [pinTargets],
  );
  const togglePinOf = useCallback(
    (to: string): void => {
      const target = pinTargets.get(to);
      if (!target) return;
      const outcome = togglePin(to);
      setPinAnnouncement(pinAnnouncementText(t, outcome, navLabel(target.item)));
    },
    [pinTargets, togglePin, t, navLabel],
  );

  // Activating the assistant row switches the palette body instead of
  // navigating (feature 043); everything else keeps the navigation path.
  const activate = useCallback(
    (to: string): void => {
      if (to === PROMPT_MODE_SENTINEL) {
        setInitialPrompt('');
        setMode('prompt');
        return;
      }
      onNavigate(to);
    },
    [onNavigate],
  );

  // `/ai` shortcut: typing `/ai` (optionally followed by a command) in the
  // palette input launches prompt mode directly, carrying any typed command
  // into the assistant input — equivalent to opening "Ask the assistant" and
  // typing it. Only intercepts when the assistant is actually usable.
  const handleQueryChange = useCallback(
    (value: string): void => {
      const match = /^\/ai(?:\s+(.*))?$/i.exec(value);
      if (match && mayUseAssistant && assistantReady) {
        setQuery('');
        setInitialPrompt(match[1] ?? '');
        setMode('prompt');
        return;
      }
      setQuery(value);
    },
    [mayUseAssistant, assistantReady],
  );

  useEffect(() => {
    setCursor(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setPinAnnouncement('');
      setQuery('');
      setMode('search');
      setInitialRequest(undefined);
      setInitialPrompt('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'prompt') {
      // Prompt mode owns its own inputs; only Esc is handled here — it
      // returns to the classic palette rather than closing (research §R9).
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setMode('search');
        }
      };
      window.addEventListener('keydown', onKey);
      return (): void => window.removeEventListener('keydown', onKey);
    }
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter' && e.altKey) {
        // Feature 164, FR-027 — `Alt+Enter` (⌥↵) pins or unpins the highlighted
        // row and never navigates; focus stays in the input.
        e.preventDefault();
        const it = items[cursor];
        if (it && pinTargetOf(it)) togglePinOf(it.to);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[cursor];
        if (it) activate(it.to);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, mode, items, cursor, onClose, activate, pinTargetOf, togglePinOf]);

  if (!open) return null;

  if (mode === 'prompt') {
    return (
      <>
        <div className="b2b-scrim" onClick={onClose} />
        <div className="b2b-palette" role="dialog" aria-modal="true">
          <PromptModePanel
            onExit={(): void => {
              setInitialRequest(undefined);
              setInitialPrompt('');
              setMode('search');
            }}
            {...(initialRequest ? { initialRequest } : {})}
            {...(initialPrompt ? { initialPrompt } : {})}
          />
        </div>
      </>
    );
  }

  // Which rows are global search's, and where they start in `items` — the
  // record blocks are rendered from the server's groups so a record type that
  // could not be searched keeps its place, with a note instead of rows.
  const showRecords = records.available && records.searchedQuery !== '';
  const firstRecordIndex = itemsBeforeSeeAll.length - recordItems.length;
  const leadingItems = itemsBeforeSeeAll.slice(0, firstRecordIndex);
  const recordsLoading = records.available && records.state === 'loading';
  const recordCount = records.groups.reduce((sum, group) => sum + group.hits.length, 0);
  const nothingAtAll = items.length === 0 && !recordsLoading && !records.groups.some((g) => g.status !== 'ok');

  const renderRow = (it: PaletteItem, i: number): ReactNode => {
    const Icon = it.icon;
    const label = resolveLabel(it);
    const sub = resolveSub(it);
    const pinTarget = pinTargetOf(it);
    const pinned = pinTarget !== undefined && isPinned(it.to);
    const pinName =
      pinTarget === undefined
        ? ''
        : t(pinned ? 'appShell.pinned.unpin' : 'appShell.pinned.pin', {
            label: navLabel(pinTarget.item),
          });
    return (
      <div
        key={`${it.group}-${it.groupKey ?? ''}-${it.to}-${i}`}
        className={cn('b2b-palette__item', i === cursor && 'is-cur')}
        onMouseEnter={(): void => setCursor(i)}
        onClick={(): void => activate(it.to)}
      >
        <Icon size={16} aria-hidden="true" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>{label}</div>
          {sub ? <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{sub}</div> : null}
        </div>
        {it.badge ? <Badge variant="secondary">{it.badge}</Badge> : null}
        {pinTarget !== undefined && i === cursor ? (
          <span className="b2b-palette__pin-hint">
            <span className="b2b-kbd-sm">{ALT_ENTER_GLYPH}</span>
            {t(pinned ? 'appShell.palette.pin.hintUnpin' : 'appShell.palette.pin.hintPin')}
          </span>
        ) : null}
        {pinTarget !== undefined ? (
          <button
            type="button"
            tabIndex={-1}
            className="b2b-palette__pin"
            aria-pressed={pinned}
            aria-keyshortcuts="Alt+Enter"
            aria-label={pinName}
            title={pinName}
            // Focus stays in the search input; the row's own activation (open
            // the destination) must not fire.
            onMouseDown={(event): void => event.preventDefault()}
            onClick={(event): void => {
              event.stopPropagation();
              togglePinOf(it.to);
            }}
          >
            {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
          </button>
        ) : null}
        <span className="meta">{i === cursor ? <span className="b2b-kbd-sm">↵</span> : null}</span>
      </div>
    );
  };

  let lastGroup = '';
  let recordIndex = firstRecordIndex;
  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <div className="b2b-palette" role="dialog" aria-modal="true">
        <div className="b2b-palette__input">
          <Search size={18} style={{ color: 'var(--fg-muted)' }} />
          <input
            ref={inputRef}
            placeholder={t('appShell.search.commandPalettePlaceholder')}
            aria-describedby={instructionsId}
            value={query}
            onChange={(e): void => handleQueryChange(e.target.value)}
          />
          <SpeechToTextButton
            startTitle={t('appShell.search.voiceInput')}
            stopTitle={t('appShell.search.voiceInputStop')}
            onTranscript={(text): void => {
              setQuery((q) => (q ? `${q} ${text}` : text));
              inputRef.current?.focus();
            }}
          />
          <span className="b2b-kbd-sm">esc</span>
          <span id={instructionsId} className="sr-only">
            {t('appShell.palette.pin.instructions')}
          </span>
        </div>
        {/* Feature 164 — pin and unpin, announced inside the modal dialog. */}
        <div role="status" aria-live="polite" className="sr-only" data-testid="palette-pin-status">
          {pinAnnouncement}
        </div>
        {/* FR-033 — a settled record search is announced without moving focus.
            Mounted before it has text: a live region that arrives already
            carrying its message is not reliably announced. */}
        <div role="status" aria-live="polite" className="sr-only" data-testid="palette-records-status">
          {showRecords && records.state === 'ready'
            ? t('appShell.palette.records.announce', { count: recordCount })
            : ''}
        </div>
        <div className="b2b-palette__list" aria-busy={recordsLoading}>
          {unseen.length > 0 ? (
            <div
              data-testid="prompt-unseen-notice"
              className="b2b-palette__item"
              style={{ cursor: 'pointer' }}
              onClick={(): void => {
                setInitialRequest(unseen[0]);
                setUnseen((u) => u.slice(1));
                setMode('prompt');
              }}
            >
              <Sparkles size={16} />
              <div>
                <div>{tp('panel.unseenNotice')}</div>
              </div>
            </div>
          ) : null}
          {nothingAtAll ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
              {t('appShell.search.noMatches')}
            </div>
          ) : (
            <>
              {leadingItems.map((it, i) => {
                const showGroup = it.group !== lastGroup;
                lastGroup = it.group;
                const groupHeader =
                  it.group === 'Navigate'
                    ? t('appShell.palette.group.navigate')
                    : it.group === 'Assistant'
                      ? tp('palette.group.label')
                      : t('appShell.palette.group.actions');
                return (
                  <div key={`${it.group}-${it.label}`}>
                    {showGroup ? <div className="b2b-palette__group">{groupHeader}</div> : null}
                    {renderRow(it, i)}
                  </div>
                );
              })}
              {recordsLoading ? (
                <div
                  className="b2b-palette__item"
                  aria-hidden="true"
                  data-palette-note=""
                  data-testid="palette-records-searching"
                  style={{ color: 'var(--fg-muted)', cursor: 'default' }}
                >
                  <Search size={16} />
                  <div>{t('appShell.palette.records.searching')}</div>
                </div>
              ) : null}
              {showRecords
                ? records.groups.map((group) => (
                    <div key={group.entityType} data-testid={`palette-records-${group.entityType}`}>
                      <div className="b2b-palette__group">
                        {group.label}
                        {group.hasMore ? (
                          <span style={{ marginLeft: 8, fontWeight: 400 }}>
                            · {t('appShell.palette.records.more')}
                          </span>
                        ) : null}
                      </div>
                      {group.status === 'ok' ? (
                        group.hits.map(() => {
                          const index = recordIndex;
                          recordIndex += 1;
                          const it = items[index];
                          return it ? renderRow(it, index) : null;
                        })
                      ) : (
                        <div
                          className="b2b-palette__item"
                          data-palette-note=""
                          style={{ color: 'var(--fg-muted)', cursor: 'default' }}
                        >
                          <div>{t('appShell.palette.records.unavailable', { label: group.label })}</div>
                        </div>
                      )}
                    </div>
                  ))
                : null}
              {seeAllItem ? renderRow(seeAllItem, items.length - 1) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
