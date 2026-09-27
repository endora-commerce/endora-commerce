# @endora-commerce/mod-assets-library

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

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

- 142fcdd: `AssetReadPort` gains `openAssetBytes(assetId)`, and `assets_library` answers it.

  ```ts
  // new, on the existing `assetReadPort` container name
  openAssetBytes(assetId: string): Promise<AssetBytes | null>;

  // new exported type
  interface AssetBytes { bytes: Uint8Array; mimeType: string }
  ```

  The bytes of one live asset, buffered, with the MIME type they were stored under. It is the
  question a composition root was answering for `invoices` — embedding the operator's logo in
  an invoice PDF, which needs an inline `data:` URI because pdfmake resolves an `image:` by
  fetching it, and fetching `/assets/file/<id>` from the process that is serving the request
  deadlocks for a public asset and 403s for a private one.

  **Absence is the answer, not an exception**, exactly as `resolvePublicUrls` states it. An id
  that names no row, a soft-deleted one, a row on the `legacy` backend (a URL this library can
  resolve and an object it cannot open) and a configured store that would not stream are all
  `null`. The caller cannot tell "this asset is not there" from "the bucket did not answer",
  so it is not the caller's decision to make.

  **Here rather than on `AssetsLibraryPort`, and rather than left at the caller over
  `ObjectStoragePort`.** It is a read, and a consumer that wants a logo must not thereby
  acquire `upload`, `patchAsset` and `softDelete` — which is the argument `ObjectStoragePort`'s
  own doc block makes in the other direction. A caller that opened the store itself would carry
  three facts about this module's storage layout instead: that `legacy` has no `open`, that the
  locator falls back to `storageUrl` when the column is empty, and that the stream has to be
  drained.

  `Uint8Array` and not `Buffer`, for the reason `AssetByteStream` gives: this package is
  compiled by `@endora-commerce/admin-kit` with `types: ["vite/client"]`, so the `Buffer` global
  is not in scope. `Buffer` satisfies the shape, so a Node caller passes one through unchanged.

  **`minor` rather than `major`**, on this interface's own precedent: `resolvePublicUrls` was
  added to it three days ago as a minor, and the reasoning holds here — the port's consumers are
  callers, and its one implementer is the package that ships it, in the same release.

- eb01958: Every URL `assets_library` produces is absolute, and the module resolves the public API
  origin itself (owner ruling **D-223**).

  **What an upgrader sees.** `AssetDetail.url`, `AssetSummary.url`,
  `getAssetUrlResponse.url`, a CMS embed's `url` and a product feed's image URL all carry an
  origin now. On a deployment that never set `assets.local.public_url_base` — the shipped
  default, blank — the same asset used to answer `/assets/file/<id>`:

  ```diff
  -{ "url": "/assets/file/2b1c…" }
  +{ "url": "https://api.example.com/assets/file/2b1c…" }
  ```

  Nothing breaks on the day this lands: both frontend helpers (`toAbsoluteAssetUrl` in the
  storefront and in `@endora-commerce/admin-kit`) pass an absolute URL through untouched, and
  `absolutizeMediaUrl` in `@endora-commerce/cms-components` does the same. What does change is
  any consumer that **compares** or **stores** the string — a test asserting
  `'/assets/file/…'`, a cache key, a stored HTML body diffed against a fresh render. It is a
  `major` for that reason and not because a signature moved.

  **The precedence, which an operator may rely on.** A configured base still wins:
  `assets.local.public_url_base`, `assets.s3.public_base_url` and `assets.gcs.public_base_url`
  are unchanged in meaning. Blank now means _this deployment's public API origin_ for
  local-FS, and still means _the bucket's own origin_ for S3 and GCS — pointing a bucket
  object at the API host would name a host that does not serve those bytes. A configured base
  written as a path (`/media`) is rebased onto the API origin rather than left relative.

  **Two required options** — a module composed by the kernel gets them from
  `registerModule`, so this is only a break for a caller constructing the module by hand:
  `assetsLibraryModule({ publicApiBaseUrl })` and `new AdapterRegistry({ publicApiBaseUrl })`,
  plus `publicApiBaseUrl` on each adapter's own options. Required rather than optional
  deliberately: an omitted origin is not a failure, it is a host-relative URL inside an
  e-mail, a push payload and a partner's feed.

  `legacyAssetResolver` (the `storage_backend='legacy'` resolver) is now the factory
  `createLegacyAssetResolver(publicApiBaseUrl)`. It still serves a stored absolute URL
  verbatim; a stored host-relative one is rebased.

  **`@endora-commerce/platform`**: `absolutizePublicUrl` is no longer exported from
  `@endora-commerce/platform/composition`. It existed for the two composition-root sites that
  rebased an asset URL, and those are gone — a consumer that rebases a URL the module already
  made absolute is a consumer that can disagree with it. The declaration is untouched in
  `kernel/public-api-base-url.ts` and returns to the barrel the day an application needs one.
  `./composition` is a host-internal subpath, so no module could name it.

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

- 034f190: Both modules declare `demo: false` — a decision recorded rather than a field filled in.

  The demo shop holds seven product-host custom-field definitions and about five hundred assets,
  and not one of them is either module's own demo data. A product attribute is a definition paired
  1:1 with a `catalog` extension row and written in one call; every demo asset is minted inside a
  loop over `catalog`'s products, with its filename and its generated image derived from the
  product it hangs off, and its id handed straight to one of `catalog`'s tables. Each is two
  modules' rows in one statement and belongs to whoever owns the instance.

  For `custom_fields` this also settles a question the feature's own artefacts left open, and
  settles it against the proposal: the definitions cannot be seeded here with the extension rows
  seeded by `catalog`, because `catalog` would then have to read `custom_field_definitions` to find
  the id its extension references, and a module's demo body may not read another module's table.

  Absent and `false` are different states, so this changes no behaviour: it says the modules owe
  nothing rather than leaving it undecided.

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

### Minor Changes

- 27ca81d: `assets_library` and `custom_fields` ship their admin surfaces.

  **New `./admin` subpath on both packages.** `@endora-commerce/mod-assets-library` and
  `@endora-commerce/mod-custom-fields` each export `contributions` — an `AdminContributions`
  object — from `@endora-commerce/mod-<id>/admin`, and nothing else. Each declares one route
  and one sidebar entry; the route components are dynamic-import factories, so a consumer's
  bundler emits one chunk per screen. The routes are unchanged: `/assets-library` and
  `/custom-fields`, gated on `assets.read` and `custom_fields:read` respectively — the codes
  the hand-written host registrations carried.

  Four things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it. Both packages' `build` and `typecheck`
    scripts now run two `tsc` invocations.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of
    both**, and `react-router-dom` of `mod-custom-fields`. The kit is where every screen's
    design-system import resolves; `react` is peered rather than depended on so the
    application resolves one copy.
  - **Each package's `i18n/` bundle gains its own `nav.*.label`** — `nav.assetsLibrary.label`
    and `nav.customFields.label` — resolved in the module's own namespace instead of the
    shared `core` one. `appShell.nav.assetsLibrary` and `appShell.nav.customFields` are
    removed from `@endora-commerce/mod-i18n`'s bundle with the host rows that named them.
  - **`mod-custom-fields`' screen no longer reads the `core` namespace at all.** It rendered
    `customFields.title` and `customFields.description` out of the shared bundle beside four
    keys of its own; both were already written in this package's `i18n/{en,pl}.json`, so the
    shared reads were a second copy of two strings. `customFields.title` and
    `customFields.save` stay in `mod-i18n` because `@endora-commerce/admin-kit`'s
    `CustomFieldValuesPanel` renders them.

  **One repair inside `mod-assets-library`, and it is a deduplication a consumer can see.**
  `AssetDetailDrawer` carried a private `toAbsoluteAssetUrl` over its own
  `import.meta.env.VITE_API_BASE_URL` read with a `http://localhost:3001` fallback — a
  fourteenth copy of the function `@endora-commerce/admin-kit/lib` publishes. It takes the
  kit's now, which is the binding `LibraryPage` two files away was already taking. There is
  one implementation of it in the tree again.

  **Nothing is removed and no existing export changes shape**, so a consumer of either
  package's `./backend`, `./migrations`, `./ports` or root subpath is unaffected. Both
  modules declare `activation.nonDeactivatable`, so neither gains an operator-facing switch:
  what the new subpath adds is where the screens live, not whether they can be withdrawn.

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

### Patch Changes

- e969343: `assets_library` declares the fifteen error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

  No `tokens` are declared: none of the fifteen carries a refusal discriminator.
  `ASSET_KIND_NOT_SUPPORTED` is not here — it carries this module's prefix and is
  `catalog`'s, which declares it.

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
