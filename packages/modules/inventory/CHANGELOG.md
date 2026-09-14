# @endora-commerce/mod-inventory

## 0.10.0

### Minor Changes

- 5f64f59: Back-in-stock notification requests are now gated as an acquisition: the caller's audience and
  the request's sales channel both have to allow the product, and every refusal is the single
  `404 PRODUCT_NOT_FOUND` the other acquisition seams already answer with.

  **Why it is a security fix.** `AvailabilityNotificationService.subscribe` resolved the product
  through the row-level catalogue read port and applied neither `isProductVisibleTo` nor the
  channel assortment gate, so a product an operator had restricted to one organisation, or
  published on one channel only, was reachable by id from the unauthenticated storefront route
  and answered differently from a product that is not there. Both storefront routes
  (`POST /api/v1/storefront/inventory/notify-when-available` and the backward-compatible
  `POST /api/v1/catalog/products/:id/notify-when-available`) went through that service, so both
  are closed by the same change.

  **What consumers have to change.** Two shapes gained a required member, both of them the same
  port:
  - `new AvailabilityNotificationService(emFactory, catalogProducts, customerAccounts, mailer?, templateEmail?)`
    becomes
    `new AvailabilityNotificationService(emFactory, catalogProducts, customerAccounts, salesChannelMembership, mailer?, templateEmail?)`.
  - `InventoryModuleOptions` gained `salesChannelMembership: SalesChannelMembershipPort`. A
    composition using the container resolves it as `salesChannelMembershipPort`; it is a kernel
    registration, so it adds no module dependency edge.

  `SubscribeInput` gained an optional `audience?: ProductAudience`, defaulted to the anonymous
  audience — a caller that does not pass one gets the most restrictive answer rather than no
  answer, which is the fail-closed end. A caller acting on behalf of a signed-in buyer should pass
  `productAudienceOf(request)`.

  `major` would be the literal shape of the constructor change; D-225 refuses one while the
  package is in `0.x`, and a `minor` already takes every caret dependent out of range.

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- 02838b7: Nine modules now declare the environment inputs they own, in `manifest.env`, so a
  client who installs them can be told what to put in their `.env`. Each declaration
  carries an English and a Polish sentence, a requirement, and — for an `optional`
  one — what is lost without it.

  `health_checks` was the tenth until D-229 dissolved it into the platform; its two
  declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
  because the platform now declares that name and a module may not describe a
  platform input a second time.

  Nothing changes at runtime: no module reads a new variable and none changes how it
  reads an existing one. What changes is that the requirement is now on the wire, in
  the manifest the platform already carries, and reaches a consumer through the
  package's own `exports` map.

  Every module here declares only what it **owns**. The seven platform-owned names
  these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
  `PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
  `SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
  are deliberately not repeated here.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- a2d2fb0: The module declares its demo data: `manifest.demo` creates the demo's second warehouse and
  assigns it to every sales channel, and withdraws both again.

  `endora demo seed` now reports `inventory` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
  nothing is loaded by the processes that merely compose the platform, and the module gained no
  `exports` subpath, no `files` entry and no manifest `dependencies` entry.

  **The demo warehouse is called `Krakow warehouse` rather than `Magazyn Kraków`.** `Warehouse.name`
  and `.description` are scalar columns, so the per-language map the demo contract asks for has
  nowhere to go, and a module's own sources are where `check:default-language-prose` refuses
  non-English prose that carries no per-language structure — measured on the move, the two former
  values were two findings. The code (`pl-krk`) and the fixed id are unchanged, so anything that
  resolved the warehouse by either is unaffected.

  **The withdrawal leaves the reconciler's assignments alone.** The demo's channel assignments and
  the ones `WarehouseChannelReconciler` makes for the system warehouse share a table, and only the
  first are the demo's: every active channel keeps a default warehouse across a demo reset.

  The stock spread across the two warehouses is **not** this module's demo data — quantities per
  product are `catalog`'s rows and this module's in one statement, so they stay with the instance
  composition, which already degrades to a single-warehouse spread when this module is absent.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

- 0ab2044: Publish the object store, the availability port and the batched category and
  asset reads `product_feeds` reached through a composition root.

  `@endora-commerce/contracts` gains four exports and one method, all additive:
  - `ObjectStoragePort` (container name `objectStoragePort`, owner
    `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
    `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
    that keeps its own objects under its own locator prefix and creates no `Asset`
    row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
    rows, not a store, so it is not in the code union and a consumer has no arm to
    probe for.
  - `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
    answered. The registration carried no type argument, so there was no name to
    import.
  - `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
    live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
    `listProductIdsInSubtree`: that one is structural by contract and is a
    recursive CTE with no cycle guard.
  - `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
    live, public asset, and nothing for the rest. Absence is the answer rather
    than an exception, because only the owner can tell a stable URL from an
    expiring signed one.

  Breaking, `@endora-commerce/mod-product-feeds`:
  - `ProductFeedsBridge` is **removed**. The module resolves the four ports above
    itself; a composition contributes nothing to it beyond deployment values.
  - `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
    becomes `objectStorage: ObjectStoragePort`. Pass the container's
    `objectStoragePort` instead of an adapter registry.
  - `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
    `services/artefact-store.js`; `ArtefactStorageBackend` is now
    `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
    `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

  Breaking, `@endora-commerce/mod-catalog`:
  - `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
    unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
    on `catalogCategoryReadPort`. It is a category read and it now has one home.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/email-components@0.8.0

## 0.7.0

### Major Changes

- f8ffc57: `currencies` and `inventory` declare their own permission codes, and their admin routes enforce
  them instead of the catalogue's and the order module's. `currencies` also takes back the four
  routes `languages` was registering on its behalf.

  **Breaking for anyone whose roles reach either module's admin API, and for anyone importing
  `I18nRoutesDeps` from `@endora-commerce/mod-languages/backend`.**

  ## `currencies` — four routes and a new owner

  The routes moved module _and_ code. They were registered by `languages` and gated on
  `catalog:write` — all four, the list read included, so seeing the currency table required the
  authority to delete a row from it:

  ```
  GET    /api/v1/admin/currencies            languages, catalog:write -> currencies, currencies:read
  PUT    /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  POST   /api/v1/admin/currencies/:code/default  languages, catalog:write -> currencies, currencies:write
  DELETE /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  ```

  `registerI18nRoutes`' `I18nRoutesDeps` no longer takes `currencyAdmin`; `currencyRead` stays, for
  `GET /api/v1/i18n/config`, which composes both catalogues into one public payload and is
  unchanged. The new entry point is `registerCurrencyRoutes` in
  `@endora-commerce/mod-currencies/backend` — but a host does not call it: the module registers its
  own routes through `ctx.routes`, which is what makes the module-presence gate structural instead
  of a note in a comment.

  `@endora-commerce/mod-currencies` gains `auth` in its manifest `dependencies` (it resolves
  `requireAdmin` now) and `fastify` in its peer dependencies.

  ## `inventory` — 21 gates

  Nine reads on `orders:read` and twelve writes on `catalog:write`, all of them over this module's
  own tables: warehouses, stock levels, display-band thresholds, the back-in-stock queue, the CSV
  importer, and the channel↔warehouse assignment that decides which stock a channel may sell.
  Every one is now `inventory:read` or `inventory:write`.

  The channel↔warehouse routes are the ones to look at if you embed
  `admin/src/modules/warehouses/ChannelMembershipPanel`: a role that may edit a sales channel and
  holds no inventory code now sees no panel, where before it saw one backed by `catalog:write`.

  `open-inventory`, the module's ⌘K action, moves from `orders:read` to `inventory:read` with its
  route.

  ## No data migration, in both cases

  Granting the new codes to every holder of `catalog:write` or `orders:read` would reproduce the
  distribution the split exists to remove, which would make this a change of spelling rather than
  of authority. A role that reached these screens through the borrowed codes is granted the new
  ones explicitly on `/admin-roles`, where the manifests put them automatically.

  `@endora-commerce/mod-i18n` carries the four `adminRoles.permission.*` labels and the inventory
  screens' refusal notice, in `en` and `pl`.

### Minor Changes

- 43e1968: `price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
  four icon names join the allowlist.

  **Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
  `contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
  each now declares its screens there too, at the paths and codes the hand-written host
  registrations carried. Sixteen routes and nine sidebar entries between them. The exported
  symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
  consumer already reading the zones needs no edit; what is new is that the same object now
  answers for the screens.
  - `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
    `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
    code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
    gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
    section at weight 100. The display-mode screen is reached from a button on the roster and the
    detail screen from the roster itself, so neither has a row of its own.
  - `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
    `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
    all. **No sidebar row**, which is the host table's own decision kept: quick order is the
    other way of getting lines into one order, reached from the `order.entry.tabs` strip this
    package already contributes into.
  - `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
    `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
    `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
    code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
    the order the host table had. Both of this module's admin surface directories moved: the
    warehouse screens and their client are here too, the sidebar having always attributed
    `/warehouses` to this module.
  - `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
    `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
    and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
    weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
    `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
    declarations already describe. Its admin client moved with the screens and is now
    `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
  `TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
  `KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
  compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
  from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
  them four rows would have had to degrade to names already on the allowlist.

  **`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
  of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

  **`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
  targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
  shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
  unchanged; what changes is that the advertisement is now resolved from the manifest against the
  effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
  hand-written row was a second copy of `open-inventory` and is simply gone.

  **`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
  four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
  `appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
  bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
  `nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
  `nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
  breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
  shared bundle gets nothing; resolve it in the owning module's namespace instead.

- eeb6a47: Four zone members for the category editor, the product editor and the sales-channel editor.

  `@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
  entry in `AdminZonePropsMap`:

  | Member                         | Props                                       | Rendered by                                           |
  | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
  | `category.editor.after`        | `CategoryEditorZoneProps { categoryId }`    | the category editor's form, after its save/cancel row |
  | `product.editor.pricing.after` | `ProductEditorZoneProps` (reused)           | the end of the product editor's Pricing tab           |
  | `product.editor.channels`      | `ProductEditorZoneProps` (reused)           | the body of the product editor's Channels tab         |
  | `sales_channel.editor.after`   | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form        |

  `CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
  `ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
  type is the shape the mount carries, and two places in one editor that both carry a product
  id carry the same shape.

  ```tsx
  import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

  // A tab whose body is a zone shows its button by counting the zone, never by
  // naming the module that fills it.
  const contributions = useAdminZone('product.editor.channels', { productId });
  // …
  <AdminZone name="product.editor.channels" props={{ productId }} />;
  ```

  `@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
  contributions — `category.editor.after` and `product.editor.pricing.after`, both at
  `price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

  **`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
  change an operator will see. A host cannot hand its own wording to a contributor it does not
  know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
  Two screens read different words than before: the category editor, which passed `catalog`'s
  `categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
  bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
  module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
  keys are now read by nothing; they are left in place because the same props are still passed
  by `organizations`' detail screen, whose conversion is a separate merge request.

  `@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
  `product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
  it. Its four calls are rebuilt from the published `apiClient` rather than moving
  `sales-channels-client`, so the package reaches nothing in the admin application.

  `@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
  `sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
  `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
  `isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
  the zone renderer applies presence and that code before the chunk is fetched — while the
  `inventory:write` half stays, because a contribution declares one code and the panel offers
  a read view and write actions behind two.

  No contribution declares a `match`: each names a member exactly one host mounts, and `match`
  narrows the mounts of one place.

- 6e6d7d7: `inventory` gains `organization_id` on `availability_notifications`, stamps it on
  the one write that owns a row, and refuses a row that names a customer account
  without one.

  `AvailabilityNotification` gains an `organizationId` property and the
  `availability_notifications` table gains a nullable `organization_id` column, an
  index on it, and
  `check ("customer_account_id" is null or "organization_id" is not null)`. The
  migration first derives the missing organisation from the account that owns each
  subscription, then refuses — with the count and up to twenty ids, deleting
  nothing — anything it could not derive. Like `push_subscriptions` and unlike
  `comparisons`, this table carries **no foreign key** on `customer_account_id`, so
  that refusal is a branch a real database can reach.

  **What changes for a reader.** `AvailabilityNotification` is `@CustomerScoped`,
  and the tenant filter's `allowed-set` arm consults the ORM's metadata for this
  column per query: an administrator whose authority is a set of organisations saw
  **no** back-in-stock subscription at all while the column was absent, and now
  sees the subscriptions of the organisations they are assigned to.
  `GET /api/v1/admin/inventory/availability-notifications` lists accordingly. The
  `meta.scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING'` disclosure that explained
  that emptiness is no longer emitted for this table — it was keyed on the column's
  absence and retires with it. An **anonymous** subscription carries no
  organisation and is therefore outside every scoped administrator's reach; who
  such a row belongs to is an open product question and is not answered here.

  **What changes for a writer.** `AvailabilityNotificationService`'s constructor is
  unchanged — it already took a `CustomerAccountReadPort` as its third argument,
  required — and `subscribe` now resolves the owning account's organisation through
  it before it creates the row. A caller naming an account that does not resolve is
  refused there, where the message can name the account, rather than at the
  constraint. `cancel`, `listForAdmin` and `processRestockedFanOut` are unchanged,
  and so is `AvailabilityWorker`: its restock fan-out reads under
  `withSystemScope`, a deliberate cross-tenant grant, and still reaches every
  organisation.

  **What can break.** An insert or update that sets `customer_account_id` without
  setting `organization_id` now fails with a check violation. A fixture or an
  external writer that builds a subscription by hand is the case to look at.

  The constraint is an **implication**, not an equivalence: an anonymous
  subscription is a representable state (FR-011) — `an_recipient_check` exists to
  admit a row whose only recipient is an e-mail address — and it carries no
  organisation. No foreign key is added.

- 44d0ec3: `customer_accounts` and `inventory` become workspace packages (feature 080,
  T040b, batch six). Each ships `dist` and resolves through its own `exports`
  map — the root for its manifest, `./backend` for `registerModule` plus the
  `entities` array, `./migrations` for its migration classes, and, for
  `inventory`, a type-only `./ports` — exactly as the fifty-nine packages before
  them.

  **`./backend` publishes the `entities` array and no entity class by name**
  (D-168). A consumer that needs `CustomerAccount`, `CustomerGroup` or
  `PasswordResetToken` as a runtime class takes it off that array by name:

  ```ts
  import { entities } from '@endora-commerce/mod-customer-accounts/backend';
  import { entityNamed } from '<host>/packages/package-entity-lookup.js';

  const CustomerAccount = entityNamed<CustomerAccountRow>(
    entities,
    'CustomerAccount',
    '@endora-commerce/mod-customer-accounts/backend',
  );
  ```

  The `CustomerAccountsCradle` type moves with it and is named at
  `@endora-commerce/mod-customer-accounts/backend`.

  **This is the first package to declare another module package as a
  devDependency.** `@endora-commerce/mod-organizations` is reached only by
  `import type` at `@endora-commerce/mod-organizations/ports`, whose emitted
  module exports no runtime binding, so the manifest generator renders it into
  `devDependencies` at `workspace:*` and leaves `peerDependencies` alone (R4 as
  narrowed for contract surface). Nothing of `organizations` appears in this
  package's emitted `.js`; the implementation is still resolved at runtime through
  the container name `personalOrganizationProvisionPort`, so the gate that answers
  503 `MODULE_DISABLED` when `organizations` is switched off is the registration
  and not a call anybody has to remember to write.

  No exported symbol changed shape. What changed is where a consumer names it.

  **`@endora-commerce/mod-inventory` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `InventoryReservationApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { InventoryReservationApplyPort } from '@endora-commerce/mod-inventory/ports';
  ```

  **It also publishes two runtime bindings by name on `./backend`**, beside the
  `entities` array: `WarehouseChannelReconciler` and `DEFAULT_WAREHOUSE_ID`. D-168
  keeps entity classes off that door; a service and a constant are not entities,
  and the development catalog seed must hold the _same_ reconciler the platform
  composed rather than a second copy evaluated from source (D-160.6.1) — the shape
  `price_lists` already ships as `DefaultPriceListMigrator` / `DEFAULT_PRICE_LIST_ID`.

  No exported symbol changed shape. What changed is where a consumer names it.

### Patch Changes

- b9d2f12: `inventory` declares the thirteen error codes it owns.

  The module's `manifest.ts` gains an `errorCodes` array
  (`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
  sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
  changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
  chain routes here today, so a consumer sees the identical envelope for all thirteen. What
  changes is where the answer comes from — the module's own manifest rather than a table inside
  `@endora-commerce/mod-i18n` that a module outside this repository could never join.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
