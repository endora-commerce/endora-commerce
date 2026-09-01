/**
 * How many admin routes and sidebar entries each module still declares in the
 * admin's two hand-written registries (feature 091, FR-018).
 *
 * **A two-way ratchet, and never a number to raise.** A count below the walk is
 * a module that grew a hand-written registration nobody was asked about — the
 * shape this feature exists to stop being the only way to add an admin screen.
 * A count above it is a number left standing after the registrations went,
 * which is the stale direction every ledger in this tree refuses.
 *
 * It exists because those two counts are facts *about* the module surface
 * directories and are derived nowhere, and **the batch that moves a directory
 * does not touch either file** — the exact shape AGENTS.md records as having
 * produced three reds on `master` in a row. A batch that moves `blog`'s seven
 * screens into its package and leaves its seven `<Route>` elements standing
 * produces an admin that declares each of them twice, with `react-router`
 * silently taking the first match.
 *
 * The numbers below were measured on 2026-08-29 against a tree in which **no**
 * admin directory has moved: 150 routes and 100 nav entries, of which 146 and
 * 97 belong to a module. They shrink with every Story 3 batch, and when the
 * last module entry goes the check has nothing to ratchet and is deleted with
 * this file — `expected=0` is exit 2 in the `read:` grammar, and an instrument
 * with an empty population is the done signal that says nothing.
 *
 * **`import_export` is the first entry to go, and its going is the evidence**
 * (feature 091, Phase 2). Its one route and one sidebar entry now live in
 * `packages/modules/import_export/src/admin/index.ts`, so the walk finds none
 * and the entry that described them is stale — which is what this ratchet is
 * for. The run before the conversion read
 * `routes=150 nav=100 module-owned (routes=146 nav=97) over 52 modules`; the
 * run after it reads
 * `routes=149 nav=99 module-owned (routes=145 nav=96) over 51 modules`. Never
 * raise a number to make the build pass; this one fell.
 *
 * **`google_analytics` is the second, and the first batch of the drain**
 * (feature 091, Phase 4). It was chosen by `research.md` §6's rule — ascending
 * incoming cross-module reach — and it has none in either direction, which is
 * the property that lets a directory move on its own. Its three routes and one
 * sidebar entry now live in
 * `packages/modules/google_analytics/src/admin/index.ts`; the run after it
 * reads `routes=146 nav=98 module-owned (routes=142 nav=95) over 50 modules`.
 *
 * **`analytics` is the third, and the second batch of the drain** (feature 091,
 * Phase 4). Same rule, same tie-break: it has zero incoming cross-module reach
 * and is the only remaining zero-incoming directory whose every host symbol
 * `@endora-commerce/admin-kit` publishes — the rest of that rung reach either a
 * Group A picker or the Group B session cluster, both of which
 * `backend/scripts/ledgers/admin-surface.ts` records as unpublished. Its one
 * route and one sidebar entry now live in
 * `packages/modules/analytics/src/admin/index.ts`; the run after it reads
 * `routes=145 nav=97 module-owned (routes=141 nav=94) over 49 modules`.
 *
 * **`linkedin_ads` and `meta_ads` are the fourth and fifth, and the third batch
 * of the drain** (feature 091, Phase 4). They are the first pair to be taken
 * together and the first batch to *pay* a boundary debt rather than to find
 * none. The entry above says the zero-incoming rung was exhausted; re-measured,
 * that reading had enumerated the directories with zero reach in **both**
 * directions, and eighteen more carry zero incoming reach with one or more
 * outgoing. These two sit at the top of that set: every host symbol their six
 * files take is published by `@endora-commerce/admin-kit`, and their four
 * outgoing reaches all land on one target — `sales_channels`' admin client —
 * and are retired by the exit their ledger shards name, the caller building the
 * request from the published `apiClient` and the contract's own types. Both
 * shards are deleted with the reaches. Their six routes and two sidebar entries
 * now live in `packages/modules/{linkedin_ads,meta_ads}/src/admin/index.ts`;
 * the run after them reads
 * `routes=139 nav=95 module-owned (routes=135 nav=92) over 47 modules`.
 *
 * **`mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` are the
 * sixth through tenth, and the fourth batch of the drain** (feature 091, Phase
 * 4). It is the **zero-drain** rung — none of the five carries a cross-module
 * admin reach in either direction, and none has an entry in
 * `admin-surface.ts`, so `check:module-boundary` reads the same numbers on both
 * sides and that agreement is the measurement rather than a silence.
 *
 * The rung existed all along and the previous batches could not see it. Both of
 * them rejected candidates on two criteria — a module contributing **no nav
 * entry**, and a module declaring **`activation.nonDeactivatable`** — which
 * `plan.md`'s two rulings measure as sound *pilot-evidence* criteria and wrong
 * as *selection* criteria: applied as selection they exclude 22 of the 47
 * remaining owners, and this check is then never deleted, which is SC-007 not
 * happening. `admin/src/App.tsx`'s `ModuleRoute` gates **every** registry route
 * on `useSurfaceVisibility`, so a nav-less module's off-state test drives the
 * route — a stronger subject than the sidebar, being what an operator following
 * a stale deep link meets — and a locked module is outside Constitution XVII
 * item 6's population by the owner's own measurement in
 * `specs/deferred-defects.md`, so its test asserts the permission axis it has
 * and asserts the missing axis as a fact read from its manifest.
 *
 * **Both halves of the ratchet move, including the zeros.**
 * `mfa: { routes: 1, nav: 0 }` and `admin_roles: { routes: 0, nav: 1 }` are
 * removed like any other entry: a zero that stays zero is a passing assertion,
 * not a missing one, which is the arithmetic the *"only half the ratchet would
 * move"* objection had wrong. The run after them reads
 * `routes=133 nav=92 module-owned (routes=129 nav=89) over 42 modules`.
 *
 * **`dhl_parcel`, `inpost`, `autopay`, `paypal`, `payu`, `stripe` and `tpay`
 * are the eleventh through seventeenth, and the fifth batch of the drain**
 * (feature 091, Phase 4). One family — a settings screen reached from another
 * module's card, one route each and not one sidebar entry among them — and the
 * first batch since batch three to **pay** reaches rather than to find none.
 * All seven were excluded from batches two and three by the nav-less criterion
 * `plan.md`'s Ruling 1 retires, so the entry above's arithmetic applies to them
 * unchanged: `{ routes: 1, nav: 0 }` is removed like any other entry, and the
 * zero that stays zero is a passing assertion.
 *
 * The seven reaches take **two** exits, both of them batch three's. The five
 * gateways each imported `dictionaries`' admin client for one call and now
 * build it from the published `apiClient` and
 * `DictionaryCountriesPageResponse`; their five ledger shards are deleted with
 * it. The two carriers were reached from the **other** direction — one file,
 * `admin/src/modules/orders/OrderShipmentsTab.tsx`, importing both adapters'
 * clients — which is why the shard says the batch takes both or neither, and
 * `orders` now builds those four calls itself. `check:module-boundary` reads
 * `cross-module reaches=83 -> 76`, `ledger-size 83 -> 76`, `shards 25 -> 20`.
 * The run after them reads
 * `routes=126 nav=92 module-owned (routes=122 nav=89) over 35 modules`.
 *
 * **`host` does not move, and the one thing that could have moved it is the
 * `/settings/dhl-parcel` redirect.** It is a `<Navigate>` whose element comes
 * from `react-router-dom` rather than from a surface directory, so it was
 * already attributed to the admin application and stays there; the module's own
 * route — the redirect's destination — is what left `App.tsx`.
 *
 * Two attributions, deliberately different, because the tree disagrees about
 * one screen: a **route** belongs to the module whose surface directory
 * `App.tsx` imports its component from, and a **nav entry** belongs to the
 * `module` field it already carries — `/admin-roles` renders a component
 * `admin_users` holds while its sidebar row declares `module: 'admin_roles'`,
 * and forcing one attribution on both would lose whichever fact it did not
 * pick. **Batch four moved that screen and kept the split**, which is
 * `plan.md`'s open question 3 answered as it recommended: `admin_users`'
 * package declares the `/admin-roles` route because the screen's API is its
 * own, `admin_roles`' package declares the sidebar entry and the palette action
 * because the advertisement is the roles capability's, and each says so in its
 * own `src/admin/index.ts`. Both modules are `nonDeactivatable`, so it is inert
 * today and stops being inert the day either is unlocked.
 *
 * **`pwa` is the eighteenth, and the sixth batch of the drain** (feature 091,
 * Phase 4). One entry, and the entry is the batch: it declares a **sidebar
 * entry and no route**, which is the half of `AdminContributions` nothing had
 * exercised — the type's own doc block says *"a module shipping only a nav
 * entry pointing at a host route is legal"*, and until now every conversion
 * moved a route. `/settings/pwa` renders `PwaPage`, which lives under
 * `admin/src/modules/settings/pages/`, so the route is `settings`' by this
 * check's attribution and stays in `App.tsx`; only the advertisement moved.
 * That is the `/admin-roles` split of the entry above arriving a second time,
 * and it is why `{ routes: 0, nav: 1 }` is removed like any other entry rather
 * than edited. The run after it reads
 * `routes=126 nav=91 module-owned (routes=122 nav=88) over 34 modules`.
 *
 * **The other seven candidates of that batch were dropped, and what they were
 * dropped for is worth more than the entry.** Route and nav counts are not a
 * proxy for how simple a directory is to move; admin **reach** is. Measured
 * against the three ledgers that record it — the cross-module shards,
 * `admin-surface.ts`, and this file — `assets_library` (15 incoming reaches),
 * `custom_fields` (4), `quick_order` (2, plus two unpublished host symbols) and
 * `ksef` (1 incoming, 1 outgoing, 4 unpublished) are reached *as components* by
 * screens other modules own, which is FR-007's contribution-zone question and
 * not a batch's; `seo` and `taxes` each reach a Group A picker
 * (`catalog`'s `ProductPicker`, `dictionaries`' `CountryPicker`) whose retiring
 * condition `admin-surface.ts` names as kit publication; and
 * `customer_accounts` is one symbol from clean — `useAuth`, the Group B session
 * cluster, whose retiring condition is a merge request of its own. `pwa` is the
 * only module in the whole remaining table with zero of all three.
 *
 * **Batch 7 removes four entries and 25 registrations** — `promotions` (5/4),
 * `payment_methods` (1/2), `customer_accounts` (1/1) and `product_feeds` (10/1),
 * the plan's batch 7 delivered whole. The paragraph above records
 * `customer_accounts` as *"one symbol from clean — `useAuth`, the Group B
 * session cluster, whose retiring condition is a merge request of its own"*.
 * That merge request is P3 (!1220), which published the whole cluster into
 * `@endora-commerce/admin-kit/lib`; the sentence is left standing because it
 * was a true measurement of the tree batch four was picked from, and the entry
 * it describes is gone here rather than the history being rewritten.
 *
 * **Three of the four pay no reach and the fourth pays one**, which is stated
 * because an unchanged `check:module-boundary` line is otherwise
 * indistinguishable from a laundered move. None of the four appears in
 * `admin-surface.ts`, and only `product_feeds` has a shard — one key,
 * `ProductFeedCreatePage.tsx` reaching `sales_channels`' admin client, paid by
 * rebuilding both calls from the published `apiClient` in the module's own
 * `api.ts`. That shard is deleted.
 *
 * **`assets_library`'s 15 are paid** (P4c), so its row is no longer held out of a
 * batch by this paragraph. All fifteen were `AssetPicker`, `AssetUploader`,
 * `toAbsoluteAssetUrl` and one `getAsset` — a picker, an uploader, a two-branch
 * URL helper and a single `GET`, none of which turned out to be
 * `assets_library`' *code* once `admin-component-contribution.md` Z1.1 read
 * them rather than counting them. They are `@endora-commerce/admin-kit`'s now
 * and the module's incoming reach count is **zero**. The ranking's point is
 * unchanged and is if anything sharper: a reach count says whether a directory
 * can move, and the question behind it — *is this the owner's code, or only the
 * owner's data?* — is one a route count cannot ask and a reach count only asks
 * when somebody reads the reaches.
 *
 * **`custom_fields`' 4 are paid too** (P4e), and the reason is worth more than
 * the count, because the paragraph above got it wrong in a way a reach count
 * cannot get right. It files those four under *"reached as components by
 * screens other modules own, which is FR-007's contribution-zone question"*.
 * `admin-component-contribution.md` §9.1 read the reaches instead of counting
 * them and measured the opposite: `CustomFieldValuesPanel`'s props are
 * `(entityType, values, save)` — data in, edited data back — so all four call
 * sites hand it the **host's own** stored bag and the host's own writer, and
 * `custom_fields`' admin API serves definitions and no values at all. Nothing
 * of the owner's crosses that seam, so it was never a zone question and never a
 * fragment the owner mounts; it is a published component, and it is
 * `@endora-commerce/admin-kit`'s now. The module's incoming reach count is
 * **zero**. That is the same question this ranking's point turns on — *is this
 * the owner's code, or only the owner's data?* — answered for the second time
 * against the classification a count had suggested.
 *
 * **Batch 8 removes six entries and 19 registrations** — `seo` (1/1), `taxes`
 * (1/1), `credit_limits` (1/2), `delivery_methods` (1/2), `megamenu` (2/1) and
 * `returns` (5/1). The `nav: 2`s are the shape this ledger's own counting rule
 * produces and is worth restating: `adminNavEntries` reads any object literal
 * carrying both `to` and `module`, so a `PALETTE_ITEMS` row counts beside a
 * sidebar one. Both of those became manifest **actions**, which is the surface
 * the server's effective enabled-set filters rather than a copy nobody asked it
 * about.
 *
 * **The paragraph above is answered for `seo` and `taxes`**, in the same way
 * `assets_library`' and `custom_fields`' were. It records them as *"each reach a
 * Group A picker whose retiring condition `admin-surface.ts` names as kit
 * publication"*; that is what happened — `catalog`'s `ProductPicker` and
 * `dictionaries`' `CountryPicker` are `@endora-commerce/admin-kit`'s now, with
 * `CurrencyPicker`, `StatusTransitionGraph` and the status-badge helper beside
 * them, and ten `cross-module-imports` keys retire on the five. Four of the ten
 * belong to modules this batch does not move (`orders`, `quote_requests` twice,
 * `inventory`), which is what a shared repair looks like from the ledger's side.
 *
 * **Batch 9 removes two entries and four registrations** — `assets_library`
 * (1/1) and `custom_fields` (1/1) — and it is the batch that repairs no reach
 * because there was none left to repair. Both entries sat in the plan's *last*
 * batch on figures the two paragraphs above had already made obsolete: P4c took
 * `assets_library`' incoming reach from 13 to zero and P4e took `custom_fields`'
 * from 4 to zero, and nothing re-read the table that decides membership. The
 * re-derivation (!1241) is what found them, and this is the shape worth
 * remembering rather than the pair: a drain figure is evidence with a date on
 * it, and the merge request that pays a debt is structurally not the one that
 * reads the schedule the debt was on.
 *
 * Measured on this branch against `master` before the move: neither module owns
 * a `cross-module-imports` shard, neither is named as a target by any shard,
 * neither has a key in `admin-surface.ts` and neither has one in
 * `foreign-module-ids.ts` — so `check:module-boundary`, `check:admin-surface`
 * and `check:admin-zones` all read the same numbers on both sides, and that
 * agreement is the measurement rather than a silence. The run after them reads
 * `routes=92 nav=67 module-owned (routes=88 nav=64) over 19 modules`.
 *
 * **Two repairs the move forced rather than merely permitted, both of them
 * things a reach count cannot see.** `AssetDetailDrawer.tsx` carried a private
 * copy of `toAbsoluteAssetUrl` over its own `import.meta.env` read — a
 * fourteenth copy of the helper P4c published, invisible to that merge request
 * because a copy in the owner's own file is not a *cross-module* reach — and
 * `CustomFieldsPage.tsx` read two of its six strings out of the shared `core`
 * bundle while its own bundle already held both. A package's `tsconfig.ui.json`
 * carries no `vite/client` types and a package's screen resolves no `@/`
 * specifier, so the move refuses both in the compiler rather than in review.
 *
 * **Batch 10 removes three entries and 19 registrations** — `dictionaries`
 * (3/4), `settings` (4/4) and `credentials` (2/2) — and it is the batch that
 * takes D-191's `./admin-ui` exit, which is the last of the three seams
 * `admin-component-contribution.md` Z1.1 names and the only one no batch had
 * had to build.
 *
 * **The three travel together because the repair's two endpoints are both in
 * the batch.** Re-derived on this branch before anything moved: the only debt
 * among them is one file — `settings`' `ConfigurationReferenceInput.tsx`
 * reaching `credentials`' `ConfigurationPreviewModal`, plus the
 * `module-namespace:credentials` key that same file carried in
 * `foreign-module-ids.ts`. Neither module is named by any other shard, neither
 * has a key in `admin-surface.ts`, and `dictionaries` has none of the three at
 * all — its eleven fell to zero when batch 5 paid the five gateways' client
 * reaches and batch 8 published `CountryPicker` and `CurrencyPicker` into the
 * kit. The old sequence split `settings` and `credentials` across two rows, so
 * whichever ran first would have had to pay a reach whose other end it was not
 * moving.
 *
 * **The component reach is re-keyed, not retired**, which is the one thing
 * about this batch that will read like an omission and is not. Z11: a subpath
 * is contract surface iff its emitted module exports no runtime binding, and
 * `dist/admin-ui/index.js` exports a React component — so `check:module-boundary`
 * goes on counting it, automatically, and `cross-module reaches=30` is the same
 * number on both sides. D-191 says so in as many words: publication gives the
 * coupling a supported spelling and retires no ledger entry. The namespace half
 * **is** retired, and at the source rather than by the move: the label the
 * button renders is `settings`' own key now.
 *
 * **`/settings/pwa` is the fourth registration to move and it moves to `pwa`.**
 * Batch six converted that module's sidebar entry alone and left the route in
 * `App.tsx` because `PwaPage` lived under `admin/src/modules/settings/pages/`,
 * a directory this check attributes to `settings`. It recorded the consequence:
 * a host `<Route>` is ungated, so an operator who switched `pwa` off still
 * reached the screen — *"unchanged by this batch and closes when `settings`
 * moves"*. This is that batch, so the screen, its rule builder and its client
 * are `@endora-commerce/mod-pwa`'s and the route is declared beside the entry
 * that advertises it. `pwa` has no row here to change; `settings`' four routes
 * all leave `App.tsx`, which is what its removal asserts.
 *
 * **Two palette rows became manifest actions and two were already declared.**
 * `adminNavEntries` counts a `PALETTE_ITEMS` row beside a sidebar one, which is
 * why `credentials` reads `nav: 2` for one sidebar entry. `settings` and
 * `credentials` already declared `open-settings`, `open-credentials` and
 * `new-credential`, so their hand-written *Navigate* rows were copies the
 * server was never asked about and are simply gone; `dictionaries` declared
 * none, so `open-dictionary` and `open-dictionary-audit` arrive with the
 * destinations, code and keywords those rows carried. That is batches 7 and
 * 8's shape rather than a new one, and it is the opposite of batch 9's
 * `assets_library`, which advertised nothing and had nothing invented for it.
 *
 * The run after them reads
 * `routes=83 nav=57 module-owned (routes=79 nav=54) over 16 modules`, from
 * 92/67 (88/64 over 19) — the nine routes and ten nav entries exactly.
 *
 * `host` is the admin application's own: the four routes and three nav entries
 * that belong to no module. `platform` renders `/platform/modules`, which D-36
 * says belongs to no module and must stay host-owned.
 */
import { ADMIN_HOST_OWNER } from '../lib/admin-surfaces.js';

/** What one owner still declares. */
export interface AdminRegistrationCounts {
  /** `<Route>` elements in `App.tsx` whose component is this owner's. */
  readonly routes: number;
  /** Nav entries in `AppShell.tsx` whose `module` field is this owner's. */
  readonly nav: number;
}

/**
 * The admin application's own registrations, as opposed to a module's.
 *
 * The spelling lives in `lib/admin-surfaces.ts` since P1 of
 * `specs/091-module-owned-admin-surfaces/`, because `check:module-boundary`
 * needs the same id to attribute an admin **host** file's reaches, and this
 * ledger is deleted by batch 12 while that one outlives it. Re-exported under
 * the name this check's consumers already use.
 */
export const HOST_OWNER = ADMIN_HOST_OWNER;

export const ADMIN_REGISTRATIONS_BASELINE: Readonly<Record<string, AdminRegistrationCounts>> = {
  host: { routes: 4, nav: 3 },
  blog: { routes: 7, nav: 3 },
  catalog: { routes: 8, nav: 9 },
  cms: { routes: 11, nav: 4 },
  customers: { routes: 3, nav: 2 },
  inventory: { routes: 7, nav: 6 },
  orders: { routes: 4, nav: 4 },
  organizations: { routes: 2, nav: 2 },
  pim_ergonode: { routes: 5, nav: 1 },
  price_lists: { routes: 3, nav: 2 },
  quick_order: { routes: 1, nav: 0 },
  sales_channels: { routes: 3, nav: 2 },
};
