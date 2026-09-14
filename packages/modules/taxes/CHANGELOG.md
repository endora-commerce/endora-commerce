# @endora-commerce/mod-taxes

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

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

- 384f5e2: The module declares its demo data: `manifest.demo` creates the Polish standard VAT rule and
  withdraws it again.

  `endora demo seed` now reports `taxes` by name with the rule it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest,
  so nothing is loaded by the processes that merely compose the platform, and the module gained
  no `exports` subpath, no `files` entry and no manifest `dependencies` entry.

  **The withdrawal changed, and it is a repair.** The host's demo reset used to clear this table
  with a `truncate … cascade`, which cannot tell a demo rule from one an operator wrote. It now
  deletes only the code `seed` assigns (`pl_vat_23`), so an operator's own rules — and the
  sales-channel bindings that pointed at them — survive a demo reset.

  Seeding twice creates nothing the second time and reports the same count.

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

## 0.7.0

### Major Changes

- 69261b8: `taxes` declares `taxes:read` and `taxes:write`, and its admin routes enforce them instead of
  `catalog:write`.

  **Breaking for anyone whose roles reach this module's admin API.** All four routes moved, and
  unlike the three modules that preceded it, every one of them was gated on the catalogue's
  **write** code — there was no read gate to move:

  ```
  GET    /api/v1/admin/taxes           catalog:write -> taxes:read
  GET    /api/v1/admin/taxes/preview   catalog:write -> taxes:read
  PUT    /api/v1/admin/taxes/:code     catalog:write -> taxes:write
  DELETE /api/v1/admin/taxes/:id       catalog:write -> taxes:write
  ```

  So `taxes:read` is a capability that did not exist before rather than a rename of one: an
  operator can now be shown a VAT rate without being handed the authority to change it. Grant it
  alone for a finance or support role; grant the pair to configure rates.

  Nothing that _computes_ tax is affected. `orders`, `carts`, `product_feeds` and `quote_requests`
  resolve a rate through the `taxService` port in process; these routes serve the admin
  configuration screen and nothing else.

  There is no data migration and that is deliberate: granting the new codes to every holder of
  `catalog:write` would reproduce the distribution the change exists to remove, which would make it
  a change of spelling rather than of authority. A role that was configuring tax rules through the
  catalogue code is granted `taxes:read` / `taxes:write` on `/admin-roles`, where the manifest puts
  them automatically.

  `@endora-commerce/mod-i18n` carries the two `adminRoles.permission.taxes:*` labels and the
  screen's refusal notice, in `en` and `pl`.

### Minor Changes

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

- ad62954: Fourteen more modules become workspace packages (feature 080, T040b batch three):
  `autopay`, `comparisons`, `credentials`, `dictionaries`, `google_tag_manager`,
  `ksef`, `meta_ads`, `paypal`, `payu`, `quick_order`, `search`, `stripe`, `taxes`
  and `tpay`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes — exactly as the twenty-nine
  packages before them.

  **For a consumer of `@endora-commerce/mod-ksef`, one export is new and
  load-bearing.** `KsefUnavailableError` is now published by name on `./backend`:

  ```ts
  import { KsefUnavailableError } from '@endora-commerce/mod-ksef/backend';
  ```

  Anything implementing `KsefApiClientPort` — an overlay's client, a test double,
  a second gateway — must throw **that** class for an outage.
  `classifySubmissionError` decides "retry" from `instanceof`, so a caller holding
  a constructor of its own, or the class from a relative import into this
  package's source, gets its outage classified as `UNEXPECTED`: the submission is
  parked for an operator instead of queued for the sweep, silently. There is no
  behaviour change for a caller that already throws the module's own class.

  Nothing else in any of the fourteen changed shape. The move is a relocation:
  same entities, same migrations, same class names, same tables. The committed
  migration registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base — 158 entries,
  `declaration=2db29d89…`, `execution=c794685f…` — because packaging changes no
  manifest `dependencies` and the order is a function of those.

### Patch Changes

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
  - @endora-commerce/platform@0.7.0
