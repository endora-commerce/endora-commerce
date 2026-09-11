# @endora-commerce/mod-assets-library

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
